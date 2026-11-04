/**
 * Changing doctors' working hours: the weekly pattern (shifts per weekday, each at a branch) and
 * one-off changes for single dates (day off / special hours / an extra working day).
 *
 * Who may change whose hours (checked here, not only on the screen):
 *  - clinic admin: every doctor;
 *  - reception: the doctors of their own branch (all doctors when they work at every branch);
 *  - a doctor: their own hours, when the clinic allows it ("doctors set their own hours").
 * Nothing already booked is moved or cancelled: appointments that fall outside the new hours are
 * listed so reception can move them. Every change is audited.
 */
import { and, asc, eq, gte, inArray, lte } from "drizzle-orm";
import {
  appointments,
  branches,
  patients,
  scheduleExceptions,
  services,
  staffSchedules,
  tenantMembers,
  users,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { getSettings, hoursProblem, workDay } from "./engine";
import { overlapping, rowShifts } from "./hours";
import { MOVABLE_STATUSES } from "./status";
import { addDays, isDay, riyadhDay } from "./time";

export class HoursError extends Error {
  constructor(
    public code: "not_allowed" | "not_found" | "bad_time" | "overlap" | "wrong_branch" | "in_past",
  ) {
    super(code);
    this.name = "HoursError";
  }
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
/** Appointments this far ahead are checked against new hours. */
const CONFLICT_DAYS = 180;
const MAX_SHIFTS_PER_DAY = 6;

type Member = typeof tenantMembers.$inferSelect;

/** May this person change this doctor's hours? Any of their roles that allows it counts. */
function allowed(actor: Actor, member: Member, doctorsEditOwnHours: boolean) {
  if (actor.roles.includes("clinic_admin")) return true;
  if (
    actor.roles.includes("receptionist") &&
    (!actor.restrictedBranchId || member.branchId === actor.restrictedBranchId)
  ) {
    return true;
  }
  return (
    actor.roles.includes("practitioner") && actor.memberId === member.id && doctorsEditOwnHours
  );
}

/** The doctors whose hours this person may change (practitioners only). */
export async function editableDoctors(tx: TenantTx, actor: Actor) {
  assertCan(actor.roles, "hours:edit");
  const settings = await getSettings(tx);
  const rows = await tx
    .select({ member: tenantMembers, nameAr: users.name, nameEn: users.nameEn })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .orderBy(asc(tenantMembers.createdAt));
  return rows
    .filter((r) => r.member.roles.includes("practitioner"))
    .filter((r) => allowed(actor, r.member, settings.doctorsEditOwnHours))
    .map((r) => ({
      id: r.member.id,
      nameAr: r.nameAr,
      nameEn: r.nameEn,
      branchId: r.member.branchId,
    }));
}

async function editableMember(tx: TenantTx, actor: Actor, memberId: string) {
  assertCan(actor.roles, "hours:edit");
  const [member] = await tx.select().from(tenantMembers).where(eq(tenantMembers.id, memberId));
  if (!member || !member.roles.includes("practitioner")) throw new HoursError("not_found");
  const settings = await getSettings(tx);
  if (!allowed(actor, member, settings.doctorsEditOwnHours)) throw new HoursError("not_allowed");
  return member;
}

/** Branches this doctor can work at: their own, or every branch when not tied to one. */
async function branchesFor(tx: TenantTx, member: Member) {
  const all = await tx
    .select({ id: branches.id, nameAr: branches.nameAr, nameEn: branches.nameEn })
    .from(branches)
    .orderBy(asc(branches.sortOrder));
  return member.branchId ? all.filter((b) => b.id === member.branchId) : all;
}

function checkShift(s: { start: string; end: string }) {
  if (!TIME.test(s.start) || !TIME.test(s.end) || s.start >= s.end) {
    throw new HoursError("bad_time");
  }
}

/** Everything the "Working hours" screen shows for one doctor. */
export async function loadWorkingHours(
  tx: TenantTx,
  actor: Actor,
  memberId: string,
  now = new Date(),
) {
  const member = await editableMember(tx, actor, memberId);
  const today = riyadhDay(now);
  const [weekly, exceptions, branchRows] = await Promise.all([
    tx.select().from(staffSchedules).where(eq(staffSchedules.memberId, memberId)),
    tx
      .select()
      .from(scheduleExceptions)
      .where(and(eq(scheduleExceptions.memberId, memberId), gte(scheduleExceptions.day, today)))
      .orderBy(asc(scheduleExceptions.day), asc(scheduleExceptions.startTime)),
    branchesFor(tx, member),
  ]);
  return {
    memberId,
    branches: branchRows,
    weekly: weekly
      .flatMap((r) => rowShifts(r).map((s) => ({ weekday: r.weekday, ...s })))
      .sort((a, b) => a.weekday - b.weekday || a.start.localeCompare(b.start)),
    exceptions: exceptions.map((e) => ({
      id: e.id,
      day: String(e.day),
      kind: e.kind as "off" | "hours",
      branchId: e.branchId,
      start: e.startTime?.slice(0, 5) ?? null,
      end: e.endTime?.slice(0, 5) ?? null,
      note: e.note,
    })),
    conflicts: await hourConflicts(tx, memberId, now),
  };
}

export interface WeeklyShiftInput {
  weekday: number;
  branchId: string;
  start: string;
  end: string;
}

/** Replaces the doctor's whole weekly pattern. Returns appointments now outside the hours. */
export async function saveWeeklyHours(
  tx: TenantTx,
  actor: Actor,
  input: { memberId: string; shifts: WeeklyShiftInput[] },
  now = new Date(),
) {
  const member = await editableMember(tx, actor, input.memberId);
  const branchIds = new Set((await branchesFor(tx, member)).map((b) => b.id));
  for (const s of input.shifts) {
    if (!Number.isInteger(s.weekday) || s.weekday < 0 || s.weekday > 6) {
      throw new HoursError("bad_time");
    }
    checkShift(s);
    if (!branchIds.has(s.branchId)) throw new HoursError("wrong_branch");
  }
  for (let wd = 0; wd < 7; wd++) {
    const day = input.shifts.filter((s) => s.weekday === wd);
    if (day.length > MAX_SHIFTS_PER_DAY) throw new HoursError("bad_time");
    if (overlapping(day)) throw new HoursError("overlap");
  }
  await tx.delete(staffSchedules).where(eq(staffSchedules.memberId, member.id));
  if (input.shifts.length) {
    await tx.insert(staffSchedules).values(
      input.shifts.map((s) => ({
        tenantId: actor.tenantId,
        memberId: member.id,
        branchId: s.branchId,
        weekday: s.weekday,
        startTime: s.start,
        endTime: s.end,
      })),
    );
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "schedule.weekly_update",
    entityType: "tenant_member",
    entityId: member.id,
    metadata: {
      shifts: input.shifts.map((s) => `${s.weekday} ${s.start}-${s.end}`),
    },
  });
  return { conflicts: await hourConflicts(tx, member.id, now) };
}

export interface ExceptionInput {
  memberId: string;
  day: string;
  kind: "off" | "hours";
  branchId?: string | null;
  start?: string | null;
  end?: string | null;
  note?: string | null;
}

/**
 * Adds a one-off change for one date. "Off" replaces any special hours that day; special hours
 * replace an "off" (several special-hours shifts on one date are fine, as long as they don't overlap).
 */
export async function addHoursException(
  tx: TenantTx,
  actor: Actor,
  input: ExceptionInput,
  now = new Date(),
) {
  const member = await editableMember(tx, actor, input.memberId);
  if (!isDay(input.day)) throw new HoursError("bad_time");
  if (input.day < riyadhDay(now)) throw new HoursError("in_past");
  const sameDay = await tx
    .select()
    .from(scheduleExceptions)
    .where(and(eq(scheduleExceptions.memberId, member.id), eq(scheduleExceptions.day, input.day)));
  const note = input.note?.trim().slice(0, 200) || null;

  if (input.kind === "off") {
    if (sameDay.length) {
      await tx.delete(scheduleExceptions).where(
        inArray(
          scheduleExceptions.id,
          sameDay.map((e) => e.id),
        ),
      );
    }
    await tx.insert(scheduleExceptions).values({
      tenantId: actor.tenantId,
      memberId: member.id,
      day: input.day,
      kind: "off",
      note,
      createdBy: actor.userId,
    });
  } else {
    const shift = { start: input.start ?? "", end: input.end ?? "" };
    checkShift(shift);
    const branchIds = new Set((await branchesFor(tx, member)).map((b) => b.id));
    if (!input.branchId || !branchIds.has(input.branchId)) throw new HoursError("wrong_branch");
    const otherHours = sameDay
      .filter((e) => e.kind === "hours")
      .map((e) => ({ start: e.startTime!.slice(0, 5), end: e.endTime!.slice(0, 5) }));
    if (overlapping([...otherHours, shift])) throw new HoursError("overlap");
    const offs = sameDay.filter((e) => e.kind === "off");
    if (offs.length) {
      await tx.delete(scheduleExceptions).where(
        inArray(
          scheduleExceptions.id,
          offs.map((e) => e.id),
        ),
      );
    }
    await tx.insert(scheduleExceptions).values({
      tenantId: actor.tenantId,
      memberId: member.id,
      day: input.day,
      kind: "hours",
      branchId: input.branchId,
      startTime: shift.start,
      endTime: shift.end,
      note,
      createdBy: actor.userId,
    });
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "schedule.exception_add",
    entityType: "tenant_member",
    entityId: member.id,
    metadata: { day: input.day, kind: input.kind, start: input.start, end: input.end },
  });
  return { conflicts: await hourConflicts(tx, member.id, now) };
}

/** Removes a one-off change (the weekly pattern applies again that day). */
export async function removeHoursException(
  tx: TenantTx,
  actor: Actor,
  id: string,
  now = new Date(),
) {
  const [row] = await tx.select().from(scheduleExceptions).where(eq(scheduleExceptions.id, id));
  if (!row) throw new HoursError("not_found");
  await editableMember(tx, actor, row.memberId);
  await tx.delete(scheduleExceptions).where(eq(scheduleExceptions.id, id));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "schedule.exception_remove",
    entityType: "tenant_member",
    entityId: row.memberId,
    metadata: { day: String(row.day), kind: row.kind },
  });
  return { conflicts: await hourConflicts(tx, row.memberId, now) };
}

/**
 * Upcoming appointments of this doctor that no longer fit their hours (nothing is changed:
 * reception moves them). Checked over the next CONFLICT_DAYS days.
 */
export async function hourConflicts(tx: TenantTx, memberId: string, now = new Date()) {
  const rows = await tx
    .select({
      id: appointments.id,
      branchId: appointments.branchId,
      startsAt: appointments.startsAt,
      blockedUntil: appointments.blockedUntil,
      patientId: appointments.patientId,
      patientAr: patients.fullNameAr,
      patientEn: patients.fullNameEn,
      serviceAr: services.nameAr,
      serviceEn: services.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        eq(appointments.practitionerId, memberId),
        inArray(appointments.status, [...MOVABLE_STATUSES]),
        gte(appointments.startsAt, now),
        lte(
          appointments.startsAt,
          new Date(`${addDays(riyadhDay(now), CONFLICT_DAYS)}T23:59:59+03:00`),
        ),
      ),
    )
    .orderBy(asc(appointments.startsAt));
  const cache = new Map<string, Awaited<ReturnType<typeof workDay>>>();
  const out: typeof rows = [];
  for (const a of rows) {
    const day = riyadhDay(a.startsAt);
    const key = `${a.branchId}:${day}`;
    if (!cache.has(key)) cache.set(key, await workDay(tx, memberId, a.branchId, day));
    const wd = cache.get(key)!;
    if (typeof wd === "string" || hoursProblem(wd, a.startsAt, a.blockedUntil)) out.push(a);
  }
  return out.map((a) => ({
    id: a.id,
    startsAt: a.startsAt.toISOString(),
    patientId: a.patientId,
    patientAr: a.patientAr,
    patientEn: a.patientEn,
    serviceAr: a.serviceAr,
    serviceEn: a.serviceEn,
  }));
}
