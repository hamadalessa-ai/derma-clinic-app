/**
 * The booking engine. Every screen books, moves, cancels and changes status through here,
 * so the rules (working hours, breaks, holidays, statuses, audit) are applied everywhere.
 *
 * Double-booking is prevented by the DATABASE (exclusion constraint on reservations,
 * db/booking.sql). This code also checks first so it can explain the problem nicely, but
 * if two people book the same slot at the same moment, Postgres refuses the second one.
 */
import { and, asc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  appointments,
  branchHolidays,
  devices,
  patients,
  reservations,
  rooms,
  services,
  staffSchedules,
  tenantMembers,
  tenantSettings,
  timeBlocks,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { canTransition, MOVABLE_STATUSES, type AppointmentStatus } from "./status";
import { addMinutes, atRiyadh, minutesOf, overlaps, riyadhDay, weekdayOf } from "./time";

export type BookingErrorCode =
  | "slot_taken" // the doctor, room or device is already reserved
  | "closed" // branch holiday
  | "not_working" // doctor doesn't work that day at that branch
  | "outside_hours"
  | "during_break"
  | "no_room"
  | "no_device"
  | "not_practitioner"
  | "wrong_branch"
  | "in_past"
  | "bad_status"
  | "not_found"
  | "not_allowed";

export class BookingError extends Error {
  constructor(
    public code: BookingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "BookingError";
  }
}

export type Appointment = typeof appointments.$inferSelect;
type Service = typeof services.$inferSelect;
type Member = typeof tenantMembers.$inferSelect;

/** Turns the database's "overlap" refusal into a friendly error. */
function isOverlapError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23P01" || e?.cause?.code === "23P01";
}

async function rethrowOverlap<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (isOverlapError(err)) throw new BookingError("slot_taken");
    throw err;
  }
}

/** Runs `fn` inside a SAVEPOINT so a refused insert doesn't spoil the surrounding transaction. */
async function attempt<T>(tx: TenantTx, fn: (tx: TenantTx) => Promise<T>): Promise<T> {
  return rethrowOverlap(() => tx.transaction(fn));
}

// ─── Loading ────────────────────────────────────────────────────────────────

export async function getService(tx: TenantTx, id: string): Promise<Service> {
  const [s] = await tx.select().from(services).where(eq(services.id, id)).limit(1);
  if (!s || !s.isActive) throw new BookingError("not_found", "service");
  return s;
}

export async function getPractitioner(tx: TenantTx, memberId: string, branchId: string) {
  const [m] = await tx.select().from(tenantMembers).where(eq(tenantMembers.id, memberId)).limit(1);
  if (!m) throw new BookingError("not_found", "practitioner");
  if (!m.roles.includes("practitioner")) throw new BookingError("not_practitioner");
  if (m.branchId && m.branchId !== branchId) throw new BookingError("wrong_branch");
  return m;
}

export async function getSettings(tx: TenantTx) {
  const [s] = await tx.select().from(tenantSettings).limit(1);
  return s ?? { doctorsManageOwnSchedule: false, slotMinutes: 15 };
}

/** Practitioners who work at this branch (their own branch, or all branches). */
export async function branchPractitioners(tx: TenantTx, branchId: string): Promise<Member[]> {
  const rows = await tx
    .select()
    .from(tenantMembers)
    .where(or(isNull(tenantMembers.branchId), eq(tenantMembers.branchId, branchId)))
    .orderBy(asc(tenantMembers.createdAt));
  return rows.filter((m) => m.roles.includes("practitioner"));
}

// ─── Working hours ──────────────────────────────────────────────────────────

export interface WorkDay {
  start: Date;
  end: Date;
  breakStart: Date | null;
  breakEnd: Date | null;
}

/** The doctor's hours on a clinic day at a branch, or a reason they can't be booked. */
export async function workDay(
  tx: TenantTx,
  memberId: string,
  branchId: string,
  day: string,
): Promise<WorkDay | BookingErrorCode> {
  const holiday = await tx
    .select({ id: branchHolidays.id })
    .from(branchHolidays)
    .where(
      and(
        eq(branchHolidays.day, day),
        or(isNull(branchHolidays.branchId), eq(branchHolidays.branchId, branchId)),
      ),
    )
    .limit(1);
  if (holiday.length) return "closed";

  const [schedule] = await tx
    .select()
    .from(staffSchedules)
    .where(
      and(
        eq(staffSchedules.memberId, memberId),
        eq(staffSchedules.branchId, branchId),
        eq(staffSchedules.weekday, weekdayOf(day)),
      ),
    )
    .limit(1);
  if (!schedule) return "not_working";
  return {
    start: atRiyadh(day, schedule.startTime.slice(0, 5)),
    end: atRiyadh(day, schedule.endTime.slice(0, 5)),
    breakStart: schedule.breakStart ? atRiyadh(day, schedule.breakStart.slice(0, 5)) : null,
    breakEnd: schedule.breakEnd ? atRiyadh(day, schedule.breakEnd.slice(0, 5)) : null,
  };
}

/** Checks a slot against working hours and break. Returns null when fine. */
export function hoursProblem(wd: WorkDay, start: Date, until: Date): BookingErrorCode | null {
  if (start < wd.start || until > wd.end) return "outside_hours";
  if (wd.breakStart && wd.breakEnd && overlaps(start, until, wd.breakStart, wd.breakEnd)) {
    return "during_break";
  }
  return null;
}

// ─── Free rooms and devices ─────────────────────────────────────────────────

async function busyResources(tx: TenantTx, start: Date, until: Date, ignoreAppointment?: string) {
  const rows = await tx
    .select({ kind: reservations.resourceKind, id: reservations.resourceId })
    .from(reservations)
    .where(
      and(
        sql`${reservations.during} && tstzrange(${start.toISOString()}::timestamptz, ${until.toISOString()}::timestamptz, '[)')`,
        ignoreAppointment
          ? sql`${reservations.appointmentId} is distinct from ${ignoreAppointment}::uuid`
          : undefined,
      ),
    );
  return new Set(rows.map((r) => `${r.kind}:${r.id}`));
}

async function pickRoomAndDevice(
  tx: TenantTx,
  opts: {
    branchId: string;
    service: Service;
    start: Date;
    until: Date;
    roomId?: string | null;
    deviceId?: string | null;
    ignoreAppointment?: string;
  },
) {
  const busy = await busyResources(tx, opts.start, opts.until, opts.ignoreAppointment);
  let deviceId: string | null = null;
  let deviceRoom: string | null = null;

  if (opts.service.requiredDeviceType) {
    const candidates = await tx
      .select()
      .from(devices)
      .where(
        and(
          eq(devices.branchId, opts.branchId),
          eq(devices.deviceType, opts.service.requiredDeviceType),
          opts.deviceId ? eq(devices.id, opts.deviceId) : undefined,
        ),
      )
      .orderBy(asc(devices.createdAt));
    const free = candidates.find((d) => !busy.has(`device:${d.id}`));
    if (!free) throw new BookingError(candidates.length ? "slot_taken" : "no_device");
    deviceId = free.id;
    deviceRoom = free.roomId;
  }

  const wantedRoom = opts.roomId ?? deviceRoom;
  const roomRows = await tx
    .select()
    .from(rooms)
    .where(
      and(eq(rooms.branchId, opts.branchId), wantedRoom ? eq(rooms.id, wantedRoom) : undefined),
    )
    .orderBy(asc(rooms.createdAt));
  const room = roomRows.find((r) => !busy.has(`room:${r.id}`));
  if (!room) throw new BookingError(roomRows.length ? "slot_taken" : "no_room");
  return { roomId: room.id, deviceId };
}

// ─── Booking ────────────────────────────────────────────────────────────────

export interface BookInput {
  branchId: string;
  patientId: string;
  serviceId: string;
  practitionerId: string;
  startsAt: Date;
  roomId?: string | null;
  deviceId?: string | null;
  receptionNote?: string | null;
  /** Demo seeding only: allow times in the past. */
  allowPast?: boolean;
}

export async function bookAppointment(tx: TenantTx, actor: Actor, input: BookInput) {
  const service = await getService(tx, input.serviceId);
  await getPractitioner(tx, input.practitionerId, input.branchId);
  const [patient] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(eq(patients.id, input.patientId))
    .limit(1);
  if (!patient) throw new BookingError("not_found", "patient");

  const start = input.startsAt;
  if (!input.allowPast && start.getTime() < Date.now() - 5 * 60_000) {
    throw new BookingError("in_past");
  }
  const end = addMinutes(start, service.durationMinutes);
  const until = addMinutes(end, service.bufferMinutes);

  const wd = await workDay(tx, input.practitionerId, input.branchId, riyadhDay(start));
  if (typeof wd === "string") throw new BookingError(wd);
  const problem = hoursProblem(wd, start, until);
  if (problem) throw new BookingError(problem);

  const { roomId, deviceId } = await pickRoomAndDevice(tx, {
    branchId: input.branchId,
    service,
    start,
    until,
    roomId: input.roomId,
    deviceId: input.deviceId,
  });

  const [appt] = await attempt(tx, (sp) =>
    sp
      .insert(appointments)
      .values({
        tenantId: actor.tenantId,
        branchId: input.branchId,
        patientId: input.patientId,
        serviceId: service.id,
        practitionerId: input.practitionerId,
        roomId,
        deviceId,
        startsAt: start,
        endsAt: end,
        blockedUntil: until,
        receptionNote: input.receptionNote?.trim() || null,
        createdBy: actor.userId,
      })
      .returning(),
  );
  await audit(tx, {
    actorUserId: actor.userId,
    action: "appointment.create",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      startsAt: start.toISOString(),
      serviceId: service.id,
      practitionerId: input.practitionerId,
    },
  });
  return appt;
}

export async function getAppointment(tx: TenantTx, id: string, forUpdate = false) {
  const q = tx.select().from(appointments).where(eq(appointments.id, id)).limit(1);
  const [a] = forUpdate ? await q.for("update") : await q;
  if (!a) throw new BookingError("not_found", "appointment");
  return a;
}

export interface MoveInput {
  startsAt: Date;
  practitionerId?: string;
  roomId?: string | null;
}

/** Reschedule. Keeps the same doctor unless another is chosen; picks a free room/device again if needed. */
export async function moveAppointment(tx: TenantTx, actor: Actor, id: string, input: MoveInput) {
  const appt = await getAppointment(tx, id, true);
  if (!MOVABLE_STATUSES.includes(appt.status)) throw new BookingError("bad_status");
  const service = await getService(tx, appt.serviceId);
  const practitionerId = input.practitionerId ?? appt.practitionerId;
  await getPractitioner(tx, practitionerId, appt.branchId);

  const start = input.startsAt;
  if (start.getTime() < Date.now() - 5 * 60_000) throw new BookingError("in_past");
  const end = addMinutes(start, service.durationMinutes);
  const until = addMinutes(end, service.bufferMinutes);
  const wd = await workDay(tx, practitionerId, appt.branchId, riyadhDay(start));
  if (typeof wd === "string") throw new BookingError(wd);
  const problem = hoursProblem(wd, start, until);
  if (problem) throw new BookingError(problem);

  // Prefer the same room and device; otherwise any free one.
  let picked: { roomId: string; deviceId: string | null };
  try {
    picked = await pickRoomAndDevice(tx, {
      branchId: appt.branchId,
      service,
      start,
      until,
      roomId: input.roomId ?? appt.roomId,
      deviceId: appt.deviceId,
      ignoreAppointment: appt.id,
    });
  } catch (err) {
    if (!(err instanceof BookingError) || input.roomId) throw err;
    picked = await pickRoomAndDevice(tx, {
      branchId: appt.branchId,
      service,
      start,
      until,
      ignoreAppointment: appt.id,
    });
  }

  const [moved] = await attempt(tx, (sp) =>
    sp
      .update(appointments)
      .set({
        startsAt: start,
        endsAt: end,
        blockedUntil: until,
        practitionerId,
        roomId: picked.roomId,
        deviceId: picked.deviceId,
      })
      .where(eq(appointments.id, appt.id))
      .returning(),
  );
  await audit(tx, {
    actorUserId: actor.userId,
    action: "appointment.reschedule",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      from: appt.startsAt.toISOString(),
      to: start.toISOString(),
      fromPractitionerId: appt.practitionerId,
      toPractitionerId: practitionerId,
    },
  });
  return moved;
}

/**
 * Changes status (confirm, start, complete, no-show, cancel). "arrived" is set only by
 * the check-in flow, which also handles consent and package deduction.
 */
export async function changeStatus(
  tx: TenantTx,
  actor: Actor,
  id: string,
  to: AppointmentStatus,
  opts: { reason?: string; viaCheckIn?: boolean } = {},
) {
  const appt = await getAppointment(tx, id, true);
  if (appt.status === to) return appt; // idempotent: double taps do nothing
  if (to === "arrived" && !opts.viaCheckIn) throw new BookingError("not_allowed");
  if (!canTransition(appt.status, to)) throw new BookingError("bad_status");
  const reason = opts.reason?.trim() || null;
  const [updated] = await tx
    .update(appointments)
    .set({ status: to, ...(to === "cancelled" ? { cancelReason: reason } : {}) })
    .where(eq(appointments.id, id))
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "appointment.status",
    entityType: "appointment",
    entityId: id,
    metadata: { from: appt.status, to, ...(reason ? { reason } : {}) },
  });
  return updated;
}

// ─── Blocked time ───────────────────────────────────────────────────────────

export async function blockTime(
  tx: TenantTx,
  actor: Actor,
  input: { branchId: string; memberId: string; startsAt: Date; endsAt: Date; reason?: string },
) {
  if (input.endsAt <= input.startsAt) throw new BookingError("outside_hours");
  const [block] = await attempt(tx, (sp) =>
    sp
      .insert(timeBlocks)
      .values({
        tenantId: actor.tenantId,
        branchId: input.branchId,
        memberId: input.memberId,
        startsAt: input.startsAt,
        endsAt: input.endsAt,
        reason: input.reason?.trim() || null,
        createdBy: actor.userId,
      })
      .returning(),
  );
  await audit(tx, {
    actorUserId: actor.userId,
    action: "time_block.create",
    entityType: "time_block",
    entityId: block.id,
    metadata: {
      memberId: input.memberId,
      from: input.startsAt.toISOString(),
      to: input.endsAt.toISOString(),
    },
  });
  return block;
}

export async function removeTimeBlock(tx: TenantTx, actor: Actor, id: string) {
  const [block] = await tx.delete(timeBlocks).where(eq(timeBlocks.id, id)).returning();
  if (!block) throw new BookingError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "time_block.delete",
    entityType: "time_block",
    entityId: id,
  });
  return block;
}

// ─── Availability: next free slots ──────────────────────────────────────────

export interface FreeSlot {
  startsAt: Date;
  practitionerId: string;
  roomId: string;
  deviceId: string | null;
}

/** The next free slots for a service (any doctor, or one doctor), starting from `from`. */
export async function findFreeSlots(
  tx: TenantTx,
  opts: {
    branchId: string;
    serviceId: string;
    practitionerId?: string;
    from: Date;
    days?: number;
    limit?: number;
  },
): Promise<FreeSlot[]> {
  const service = await getService(tx, opts.serviceId);
  const settings = await getSettings(tx);
  const step = settings.slotMinutes;
  const doctors = opts.practitionerId
    ? [await getPractitioner(tx, opts.practitionerId, opts.branchId)]
    : await branchPractitioners(tx, opts.branchId);
  const roomRows = await tx.select().from(rooms).where(eq(rooms.branchId, opts.branchId));
  const deviceRows = service.requiredDeviceType
    ? await tx
        .select()
        .from(devices)
        .where(
          and(
            eq(devices.branchId, opts.branchId),
            eq(devices.deviceType, service.requiredDeviceType),
          ),
        )
    : [];
  if (service.requiredDeviceType && deviceRows.length === 0) return [];

  const days = opts.days ?? 14;
  const limit = opts.limit ?? 5;
  const firstDay = riyadhDay(opts.from);
  const horizon = addMinutes(atRiyadh(firstDay, "00:00"), days * 24 * 60);
  const resv = await tx
    .select({
      kind: reservations.resourceKind,
      id: reservations.resourceId,
      startMs: sql<string>`extract(epoch from lower(${reservations.during})) * 1000`,
      endMs: sql<string>`extract(epoch from upper(${reservations.during})) * 1000`,
    })
    .from(reservations)
    .where(
      sql`${reservations.during} && tstzrange(${opts.from.toISOString()}::timestamptz, ${horizon.toISOString()}::timestamptz, '[)')`,
    );
  const busy = resv.map((r) => ({
    key: `${r.kind}:${r.id}`,
    start: new Date(Number(r.startMs)),
    end: new Date(Number(r.endMs)),
  }));
  const isFree = (key: string, s: Date, e: Date) =>
    !busy.some((b) => b.key === key && overlaps(s, e, b.start, b.end));

  const out: FreeSlot[] = [];
  for (let d = 0; d < days && out.length < limit; d++) {
    const day = riyadhDay(addMinutes(atRiyadh(firstDay, "12:00"), d * 24 * 60));
    const candidates: FreeSlot[] = [];
    for (const doc of doctors) {
      const wd = await workDay(tx, doc.id, opts.branchId, day);
      if (typeof wd === "string") continue;
      for (let t = wd.start; t < wd.end; t = addMinutes(t, step)) {
        if (t < opts.from) continue;
        const end = addMinutes(t, service.durationMinutes);
        const until = addMinutes(end, service.bufferMinutes);
        if (hoursProblem(wd, t, until)) continue;
        if (!isFree(`practitioner:${doc.id}`, t, until)) continue;
        let deviceId: string | null = null;
        let deviceRoom: string | null = null;
        if (service.requiredDeviceType) {
          const dev = deviceRows.find((x) => isFree(`device:${x.id}`, t, until));
          if (!dev) continue;
          deviceId = dev.id;
          deviceRoom = dev.roomId;
        }
        const room = roomRows
          .filter((r) => !deviceRoom || r.id === deviceRoom)
          .find((r) => isFree(`room:${r.id}`, t, until));
        if (!room) continue;
        candidates.push({ startsAt: t, practitionerId: doc.id, roomId: room.id, deviceId });
      }
    }
    candidates.sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
    out.push(...candidates.slice(0, limit - out.length));
  }
  return out;
}

/** Appointments for a set of ids (used by request approval). */
export async function appointmentsByIds(tx: TenantTx, ids: string[]) {
  if (!ids.length) return [];
  return tx.select().from(appointments).where(inArray(appointments.id, ids));
}

/** Minutes between two "HH:MM" times (used by schedule screens). */
export function minutesBetween(a: string, b: string) {
  return minutesOf(b) - minutesOf(a);
}
