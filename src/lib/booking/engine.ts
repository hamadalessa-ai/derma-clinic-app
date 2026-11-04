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
  tenantMembers,
  tenantSettings,
  timeBlocks,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { canTransition, MOVABLE_STATUSES, type AppointmentStatus } from "./status";
import { clockShiftsOn, loadHourRows, shiftsAt, type Shift } from "./hours";
import { addMinutes, atRiyadh, minutesOf, overlaps, riyadhDay } from "./time";

export type BookingErrorCode =
  | "slot_taken" // the doctor, room or device is already reserved
  | "doctor_busy" // the doctor has another appointment or blocked time then
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
  | "not_allowed"
  // ── online booking & patient page ──
  | "online_disabled" // the clinic has online booking switched off
  | "not_online" // this service can't be booked online
  | "too_soon" // less than the minimum notice
  | "too_far" // beyond the booking horizon
  | "no_doctor" // no doctor matches (e.g. none of the chosen gender at this branch)
  | "already_booked" // this patient already has a booking at that time
  | "outside_window"; // too close to the visit to cancel/reschedule online

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

/**
 * Turns the database's "overlap" refusal into a friendly error. When many bookings race for the
 * same slot, Postgres may also stop one of them as a "deadlock" (40P01): it lost the race too.
 */
const SLOT_RACE_CODES = ["23P01", "40P01"];
function isOverlapError(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return SLOT_RACE_CODES.includes(e?.code ?? "") || SLOT_RACE_CODES.includes(e?.cause?.code ?? "");
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

export type Settings = Omit<typeof tenantSettings.$inferSelect, "tenantId" | "updatedAt">;

/** Used when a clinic has no settings row: everything online is OFF. */
const DEFAULT_SETTINGS: Settings = {
  doctorsManageOwnSchedule: false,
  doctorsEditOwnHours: true,
  slotMinutes: 15,
  demoAnchorDay: null,
  onlineBookingEnabled: false,
  onlineHorizonDays: 30,
  onlineMinNoticeMinutes: 120,
  cancellationWindowHours: 24,
  onlineRequiresApproval: false,
  showPricesOnline: true,
  showServiceInMessages: true,
  aiReceptionistEnabled: false,
  aiDailyLimit: 200,
  aiScribeEnabled: false,
  whatsappWebhookVerifiedAt: null,
};

export async function getSettings(tx: TenantTx): Promise<Settings> {
  const [s] = await tx.select().from(tenantSettings).limit(1);
  return s ?? DEFAULT_SETTINGS;
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
  /** First start and last end of the day's shifts at this branch. */
  start: Date;
  end: Date;
  /** One or more shifts; the gaps between them are breaks. */
  shifts: Shift[];
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

  // The weekly pattern, unless a one-off change for this date replaces it (lib/booking/hours.ts).
  const rows = await loadHourRows(tx, [memberId], [day]);
  const shifts = shiftsAt(
    day,
    branchId,
    clockShiftsOn(memberId, day, rows.weekly, rows.exceptions),
  );
  if (!shifts.length) return "not_working";
  return { start: shifts[0].start, end: shifts[shifts.length - 1].end, shifts };
}

/** Checks a slot against the shifts: it must fit inside ONE shift. Returns null when fine. */
export function hoursProblem(wd: WorkDay, start: Date, until: Date): BookingErrorCode | null {
  if (start < wd.start || until > wd.end) return "outside_hours";
  if (wd.shifts.some((s) => start >= s.start && until <= s.end)) return null;
  return "during_break"; // between two shifts (a break) or across one
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
      and(
        eq(rooms.branchId, opts.branchId),
        // Video consultations use the branch's video room; everything else a real room.
        eq(rooms.isVirtual, opts.service.isVirtual),
        wantedRoom ? eq(rooms.id, wantedRoom) : undefined,
      ),
    )
    .orderBy(asc(rooms.createdAt));
  const room = roomRows.find((r) => !busy.has(`room:${r.id}`));
  if (!room) throw new BookingError(roomRows.length ? "slot_taken" : "no_room");
  return { roomId: room.id, deviceId };
}

// ─── Who may do what ────────────────────────────────────────────────────────

const DOCTOR_STATUS_STEPS: readonly AppointmentStatus[] = ["confirmed", "in_session", "completed"];

function isOwn(actor: Actor, appt: { practitionerId: string }) {
  return !!actor.memberId && appt.practitionerId === actor.memberId;
}

function assertMayChangeStatus(actor: Actor, appt: Appointment, to: AppointmentStatus) {
  if (can(actor.roles, "appointments:manage")) return;
  // Approving or rejecting an online request is reception's decision, not the doctor's.
  if (appt.status === "pending") throw new BookingError("not_allowed");
  if (
    can(actor.roles, "appointments:own") &&
    isOwn(actor, appt) &&
    DOCTOR_STATUS_STEPS.includes(to)
  )
    return;
  throw new BookingError("not_allowed");
}

async function assertMayMove(tx: TenantTx, actor: Actor, appt: Appointment) {
  if (can(actor.roles, "appointments:manage")) return;
  if (can(actor.roles, "appointments:own") && isOwn(actor, appt)) {
    if ((await getSettings(tx)).doctorsManageOwnSchedule) return;
  }
  throw new BookingError("not_allowed");
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

/** Who is making a change, for the record: a staff user, or the patient (online / patient page). */
interface ChangedBy {
  userId: string | null;
  source: BookingSource;
  /** Patient-side changes: which patient did it. */
  patientId?: string;
}

type BookingSource = "reception" | "online" | "whatsapp";

const auditActor = (by: ChangedBy) => ({
  actorUserId: by.userId,
  via: by.userId ? undefined : by.source === "online" ? "patient_page" : by.source,
});

export async function bookAppointment(tx: TenantTx, actor: Actor, input: BookInput) {
  if (!can(actor.roles, "appointments:manage")) throw new BookingError("not_allowed");
  return insertAppointment(
    tx,
    actor.tenantId,
    { userId: actor.userId, source: "reception" },
    input,
  );
}

/**
 * A follow-up visit from a concern. Reception/admin may always book it. A doctor may book their
 * OWN follow-up only when the clinic lets doctors manage their own schedule; otherwise the
 * doctor sends reception a ready request instead (src/lib/whatsapp/concern-actions.ts).
 */
export async function bookFollowUp(tx: TenantTx, actor: Actor, input: BookInput) {
  if (!can(actor.roles, "appointments:manage")) {
    const own = can(actor.roles, "appointments:own") && actor.memberId === input.practitionerId;
    if (!own || !(await getSettings(tx)).doctorsManageOwnSchedule) {
      throw new BookingError("not_allowed");
    }
  }
  return insertAppointment(
    tx,
    actor.tenantId,
    { userId: actor.userId, source: "reception" },
    input,
  );
}

/** The booking itself (rules + insert + audit). Callers check who may book first. */
async function insertAppointment(
  tx: TenantTx,
  tenantId: string,
  by: ChangedBy,
  input: BookInput & { status?: "booked" | "pending" },
) {
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
        tenantId,
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
        status: input.status ?? "booked",
        source: by.source,
        createdBy: by.userId,
      })
      .returning(),
  );
  const { actorUserId, via } = auditActor(by);
  await audit(tx, {
    actorUserId,
    action: "appointment.create",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      startsAt: start.toISOString(),
      serviceId: service.id,
      practitionerId: input.practitionerId,
      source: by.source,
      ...(appt.status === "pending" ? { status: "pending" } : {}),
      ...(via ? { via, patientId: by.patientId } : {}),
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
  await assertMayMove(tx, actor, appt);
  return applyMove(tx, { userId: actor.userId, source: "reception" }, appt, input);
}

async function applyMove(tx: TenantTx, by: ChangedBy, appt: Appointment, input: MoveInput) {
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
  // Say clearly when it's the doctor who is busy (not a room or device).
  const doctorBusy = await busyResources(tx, start, until, appt.id);
  if (doctorBusy.has(`practitioner:${practitionerId}`)) throw new BookingError("doctor_busy");

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
  const { actorUserId, via } = auditActor(by);
  await audit(tx, {
    actorUserId,
    action: "appointment.reschedule",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      from: appt.startsAt.toISOString(),
      to: start.toISOString(),
      fromPractitionerId: appt.practitionerId,
      toPractitionerId: practitionerId,
      ...(via ? { via, patientId: by.patientId } : {}),
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
  assertMayChangeStatus(actor, appt, to);
  if (to === "arrived" && !opts.viaCheckIn && appt.status !== to) {
    throw new BookingError("not_allowed");
  }
  return applyStatus(tx, { userId: actor.userId, source: "reception" }, appt, to, opts.reason);
}

async function applyStatus(
  tx: TenantTx,
  by: ChangedBy,
  appt: Appointment,
  to: AppointmentStatus,
  reasonText?: string,
) {
  if (appt.status === to) return appt; // idempotent: double taps do nothing
  if (!canTransition(appt.status, to)) throw new BookingError("bad_status");
  const reason = reasonText?.trim() || null;
  const [updated] = await tx
    .update(appointments)
    .set({ status: to, ...(to === "cancelled" ? { cancelReason: reason } : {}) })
    .where(eq(appointments.id, appt.id))
    .returning();
  const { actorUserId, via } = auditActor(by);
  await audit(tx, {
    actorUserId,
    action: "appointment.status",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      from: appt.status,
      to,
      ...(reason ? { reason } : {}),
      ...(via ? { via, patientId: by.patientId } : {}),
    },
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
  const ownTime = can(actor.roles, "appointments:own") && input.memberId === actor.memberId;
  if (!can(actor.roles, "appointments:manage") && !ownTime) throw new BookingError("not_allowed");
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
  const [existing] = await tx.select().from(timeBlocks).where(eq(timeBlocks.id, id)).limit(1);
  if (!existing) throw new BookingError("not_found");
  const ownTime = can(actor.roles, "appointments:own") && existing.memberId === actor.memberId;
  if (!can(actor.roles, "appointments:manage") && !ownTime) throw new BookingError("not_allowed");
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
    /** Only these doctors (e.g. online "any female doctor"). */
    practitionerIds?: readonly string[];
    from: Date;
    days?: number;
    limit?: number;
    /** Rescheduling: the appointment being moved doesn't block its own new time. */
    ignoreAppointmentId?: string;
  },
): Promise<FreeSlot[]> {
  const service = await getService(tx, opts.serviceId);
  const settings = await getSettings(tx);
  const step = settings.slotMinutes;
  const doctors = opts.practitionerId
    ? [await getPractitioner(tx, opts.practitionerId, opts.branchId)]
    : (await branchPractitioners(tx, opts.branchId)).filter(
        (d) => !opts.practitionerIds || opts.practitionerIds.includes(d.id),
      );
  const roomRows = await tx
    .select()
    .from(rooms)
    .where(and(eq(rooms.branchId, opts.branchId), eq(rooms.isVirtual, service.isVirtual)));
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
      and(
        sql`${reservations.during} && tstzrange(${opts.from.toISOString()}::timestamptz, ${horizon.toISOString()}::timestamptz, '[)')`,
        opts.ignoreAppointmentId
          ? sql`${reservations.appointmentId} is distinct from ${opts.ignoreAppointmentId}::uuid`
          : undefined,
      ),
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
      // Each shift's times start at the shift's own start (e.g. 17:00 after an afternoon gap).
      const starts = wd.shifts.flatMap((sh) => {
        const list: Date[] = [];
        for (let x = sh.start; x < sh.end; x = addMinutes(x, step)) list.push(x);
        return list;
      });
      for (const t of starts) {
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

// ─── Online booking (/book) ─────────────────────────────────────────────────
// Patients are not staff: these functions run in a clinic transaction WITHOUT a staff user,
// and apply the clinic's online rules (switched on, service online, notice, horizon) themselves.

export type DoctorGender = "male" | "female";

/** Is `start` inside the online window (minimum notice … horizon)? Null when fine. */
export function onlineWindowProblem(
  settings: Pick<Settings, "onlineMinNoticeMinutes" | "onlineHorizonDays">,
  start: Date,
  now: Date = new Date(),
): BookingErrorCode | null {
  if (start < addMinutes(now, settings.onlineMinNoticeMinutes)) return "too_soon";
  if (start > addMinutes(now, settings.onlineHorizonDays * 24 * 60)) return "too_far";
  return null;
}

async function onlineService(tx: TenantTx, serviceId: string) {
  const settings = await getSettings(tx);
  if (!settings.onlineBookingEnabled) throw new BookingError("online_disabled");
  const service = await getService(tx, serviceId);
  if (!service.onlineBookable) throw new BookingError("not_online");
  return { settings, service };
}

/** Doctors patients may pick online at a branch, optionally only one gender. */
export async function onlineDoctors(
  tx: TenantTx,
  branchId: string,
  gender?: DoctorGender | null,
): Promise<Member[]> {
  const all = await branchPractitioners(tx, branchId);
  return gender ? all.filter((d) => d.gender === gender) : all;
}

/** Doctors allowed for this request: the chosen one (checked against the gender), or all matching. */
async function onlineCandidates(
  tx: TenantTx,
  input: { branchId: string; practitionerId?: string | null; gender?: DoctorGender | null },
) {
  const doctors = await onlineDoctors(tx, input.branchId, input.gender);
  const picked = input.practitionerId
    ? doctors.filter((d) => d.id === input.practitionerId)
    : doctors;
  if (!picked.length) throw new BookingError("no_doctor");
  return picked;
}

/**
 * Free online times on one day. With a doctor: that doctor's times. With "any" (optionally a
 * gender): one entry per time, for the first matching doctor free then (earliest slot first).
 */
export async function findOnlineSlots(
  tx: TenantTx,
  input: {
    branchId: string;
    serviceId: string;
    day: string; // YYYY-MM-DD (Riyadh)
    practitionerId?: string | null;
    gender?: DoctorGender | null;
    now?: Date;
  },
): Promise<FreeSlot[]> {
  const { settings } = await onlineService(tx, input.serviceId);
  const doctors = await onlineCandidates(tx, input);
  const now = input.now ?? new Date();
  const earliest = addMinutes(now, settings.onlineMinNoticeMinutes);
  const latest = addMinutes(now, settings.onlineHorizonDays * 24 * 60);
  const dayStart = atRiyadh(input.day, "00:00");
  const from = earliest > dayStart ? earliest : dayStart;
  if (riyadhDay(from) !== input.day || from > latest) return [];
  const slots = await findFreeSlots(tx, {
    branchId: input.branchId,
    serviceId: input.serviceId,
    practitionerIds: doctors.map((d) => d.id),
    from,
    days: 1,
    limit: 500,
  });
  const inWindow = slots.filter((s) => s.startsAt <= latest && riyadhDay(s.startsAt) === input.day);
  if (input.practitionerId) return inWindow;
  const seen = new Set<number>();
  return inWindow.filter((s) => {
    const t = s.startsAt.getTime();
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

/**
 * Books from the online page. "Any doctor" (optionally by gender) takes the first matching doctor
 * free at that time. Starts as "pending" when the clinic approves online bookings first.
 */
export async function bookOnline(
  tx: TenantTx,
  input: {
    tenantId: string;
    branchId: string;
    serviceId: string;
    patientId: string;
    startsAt: Date;
    practitionerId?: string | null;
    gender?: DoctorGender | null;
    now?: Date;
    /** Where the patient booked: the online page (default) or WhatsApp (AI receptionist). */
    via?: PatientChannel;
  },
) {
  const { settings } = await onlineService(tx, input.serviceId);
  const problem = onlineWindowProblem(settings, input.startsAt, input.now);
  if (problem) throw new BookingError(problem);
  const doctors = await onlineCandidates(tx, input);

  // The same patient twice at the same time (double tap, second tab) → refused.
  const [dup] = await tx
    .select({ id: appointments.id })
    .from(appointments)
    .where(
      and(
        eq(appointments.patientId, input.patientId),
        eq(appointments.startsAt, input.startsAt),
        inArray(appointments.status, ["pending", "booked", "confirmed"]),
      ),
    )
    .limit(1);
  if (dup) throw new BookingError("already_booked");

  const by: ChangedBy = {
    userId: null,
    source: input.via ?? "online",
    patientId: input.patientId,
  };
  let lastError: BookingError = new BookingError("slot_taken");
  for (const doc of doctors) {
    try {
      // Each try in a SAVEPOINT, so a refused doctor doesn't spoil the next try.
      return await tx.transaction((sp) =>
        insertAppointment(sp, input.tenantId, by, {
          branchId: input.branchId,
          patientId: input.patientId,
          serviceId: input.serviceId,
          practitionerId: doc.id,
          startsAt: input.startsAt,
          status: settings.onlineRequiresApproval ? "pending" : "booked",
        }),
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new BookingError("already_booked");
      if (!(err instanceof BookingError)) throw err;
      lastError = err;
    }
  }
  throw lastError;
}

function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.code === "23505" || e?.cause?.code === "23505";
}

// ─── Patient page (/my): the patient's own changes ──────────────────────────

/** The patient and the family members they are guardian of. */
export async function patientFamilyIds(tx: TenantTx, patientId: string): Promise<string[]> {
  const rows = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(or(eq(patients.id, patientId), eq(patients.guardianId, patientId)));
  return rows.map((r) => r.id);
}

/** Loads an appointment the patient may change online, or throws. */
async function patientOwnedForChange(
  tx: TenantTx,
  patientId: string,
  appointmentId: string,
  now: Date,
) {
  const appt = await getAppointment(tx, appointmentId, true);
  if (!(await patientFamilyIds(tx, patientId)).includes(appt.patientId)) {
    throw new BookingError("not_found", "appointment");
  }
  if (!MOVABLE_STATUSES.includes(appt.status)) throw new BookingError("bad_status");
  const settings = await getSettings(tx);
  if (appt.startsAt < addMinutes(now, settings.cancellationWindowHours * 60)) {
    throw new BookingError("outside_window");
  }
  return { appt, settings };
}

/** Where a patient's own change came from: the patient page (/my) or a WhatsApp button. */
type PatientChannel = "online" | "whatsapp";

const PATIENT_CANCEL_REASON: Record<PatientChannel, string> = {
  online: "ألغاه المريض من صفحة المريض · Cancelled by the patient (patient page)",
  whatsapp: "ألغاه المريض عبر واتساب · Cancelled by the patient (WhatsApp)",
};

export async function cancelByPatient(
  tx: TenantTx,
  input: { patientId: string; appointmentId: string; now?: Date; via?: PatientChannel },
) {
  const { appt } = await patientOwnedForChange(
    tx,
    input.patientId,
    input.appointmentId,
    input.now ?? new Date(),
  );
  return applyStatus(
    tx,
    { userId: null, source: input.via ?? "online", patientId: input.patientId },
    appt,
    "cancelled",
    PATIENT_CANCEL_REASON[input.via ?? "online"],
  );
}

/**
 * The patient confirms they will come (WhatsApp "Confirm" button). Own or family appointments only;
 * "booked" → "confirmed"; already confirmed = nothing to do. No cancellation window applies.
 */
export async function confirmByPatient(
  tx: TenantTx,
  input: { patientId: string; appointmentId: string; via?: PatientChannel },
) {
  const appt = await getAppointment(tx, input.appointmentId, true);
  if (!(await patientFamilyIds(tx, input.patientId)).includes(appt.patientId)) {
    throw new BookingError("not_found", "appointment");
  }
  if (appt.status === "confirmed") return appt;
  if (appt.status !== "booked") throw new BookingError("bad_status");
  return applyStatus(
    tx,
    { userId: null, source: input.via ?? "whatsapp", patientId: input.patientId },
    appt,
    "confirmed",
  );
}

export async function moveByPatient(
  tx: TenantTx,
  input: {
    patientId: string;
    appointmentId: string;
    startsAt: Date;
    /** Another doctor (offered when the patient's doctor has no free time). */
    practitionerId?: string;
    now?: Date;
    via?: PatientChannel;
  },
) {
  const now = input.now ?? new Date();
  const { appt, settings } = await patientOwnedForChange(
    tx,
    input.patientId,
    input.appointmentId,
    now,
  );
  const service = await getService(tx, appt.serviceId);
  if (!settings.onlineBookingEnabled) throw new BookingError("online_disabled");
  if (!service.onlineBookable) throw new BookingError("not_online");
  const problem = onlineWindowProblem(settings, input.startsAt, now);
  if (problem) throw new BookingError(problem);
  if (input.practitionerId && input.practitionerId !== appt.practitionerId) {
    // Only doctors a patient could pick online at this branch.
    const allowed = await onlineDoctors(tx, appt.branchId);
    if (!allowed.some((d) => d.id === input.practitionerId)) throw new BookingError("no_doctor");
  }
  return applyMove(
    tx,
    { userId: null, source: input.via ?? "online", patientId: input.patientId },
    appt,
    { startsAt: input.startsAt, practitionerId: input.practitionerId },
  );
}

// ─── Reschedule options (patient page, WhatsApp, reception) ────────────────

export type RescheduleRefusal =
  | "outside_window" // closer to the visit than the cancellation window
  | "online_disabled"
  | "not_online" // this service can't be changed online
  | "bad_status" // e.g. already checked in or cancelled
  | "too_far" // beyond the online booking horizon
  | "too_soon" // that day is entirely inside the minimum notice
  | "closed"; // no doctor works that day at this branch (e.g. Friday, a holiday)

export type RescheduleOptions =
  | { ok: false; reason: RescheduleRefusal; hours?: number }
  | {
      ok: true;
      practitionerId: string;
      /** Free times with the same doctor that day (the appointment never blocks itself). */
      sameDoctor: FreeSlot[];
      /** Free times with other doctors that day, per doctor. */
      otherDoctors: { practitionerId: string; slots: FreeSlot[] }[];
    };

/**
 * Where an appointment can move on one day — and if it can't, WHY (so screens can say so).
 *  - as a patient (/my, WhatsApp): own/family only, the cancellation window, the clinic's online
 *    rules (switched on, service online, notice, horizon), doctors patients may pick online;
 *  - as staff (reception calendar): any doctor of the branch, from now on.
 */
export async function rescheduleOptions(
  tx: TenantTx,
  input: {
    appointmentId: string;
    day: string;
    patientId?: string;
    now?: Date;
  },
): Promise<RescheduleOptions> {
  const now = input.now ?? new Date();
  const asPatient = !!input.patientId;
  const appt = await getAppointment(tx, input.appointmentId);
  const settings = await getSettings(tx);
  if (asPatient) {
    if (!(await patientFamilyIds(tx, input.patientId!)).includes(appt.patientId)) {
      throw new BookingError("not_found", "appointment");
    }
  }
  if (!MOVABLE_STATUSES.includes(appt.status)) return { ok: false, reason: "bad_status" };
  let from = new Date(Math.max(atRiyadh(input.day, "00:00").getTime(), now.getTime()));
  let latest: Date | null = null;
  let doctors: Member[];
  if (asPatient) {
    const hours = settings.cancellationWindowHours;
    if (appt.startsAt < addMinutes(now, hours * 60)) {
      return { ok: false, reason: "outside_window", hours };
    }
    if (!settings.onlineBookingEnabled) return { ok: false, reason: "online_disabled" };
    const service = await getService(tx, appt.serviceId);
    if (!service.onlineBookable) return { ok: false, reason: "not_online" };
    const earliest = addMinutes(now, settings.onlineMinNoticeMinutes);
    latest = addMinutes(now, settings.onlineHorizonDays * 24 * 60);
    if (atRiyadh(input.day, "00:00") > latest) return { ok: false, reason: "too_far" };
    if (earliest > from) from = earliest;
    if (riyadhDay(from) > input.day) return { ok: false, reason: "too_soon" };
    doctors = await onlineDoctors(tx, appt.branchId);
  } else {
    doctors = await branchPractitioners(tx, appt.branchId);
  }
  if (riyadhDay(from) !== input.day) {
    return { ok: true, practitionerId: appt.practitionerId, sameDoctor: [], otherDoctors: [] };
  }
  const ids = [...new Set([appt.practitionerId, ...doctors.map((d) => d.id)])];
  // Closed that day (weekend, holiday, nobody scheduled)? Say so instead of "no free times".
  let anyoneWorks = false;
  for (const id of ids) {
    if (typeof (await workDay(tx, id, appt.branchId, input.day)) !== "string") {
      anyoneWorks = true;
      break;
    }
  }
  if (!anyoneWorks) return { ok: false, reason: "closed" };
  const slots = (
    await findFreeSlots(tx, {
      branchId: appt.branchId,
      serviceId: appt.serviceId,
      practitionerIds: ids,
      from,
      days: 1,
      limit: 1000,
      ignoreAppointmentId: appt.id,
    })
  ).filter(
    (s) =>
      riyadhDay(s.startsAt) === input.day &&
      (!latest || s.startsAt <= latest) &&
      !(
        s.practitionerId === appt.practitionerId && s.startsAt.getTime() === appt.startsAt.getTime()
      ),
  );
  const others = new Map<string, FreeSlot[]>();
  for (const s of slots) {
    if (s.practitionerId === appt.practitionerId) continue;
    others.set(s.practitionerId, [...(others.get(s.practitionerId) ?? []), s]);
  }
  return {
    ok: true,
    practitionerId: appt.practitionerId,
    sameDoctor: slots.filter((s) => s.practitionerId === appt.practitionerId),
    otherDoctors: doctors
      .filter((d) => others.has(d.id))
      .map((d) => ({ practitionerId: d.id, slots: others.get(d.id)! })),
  };
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
