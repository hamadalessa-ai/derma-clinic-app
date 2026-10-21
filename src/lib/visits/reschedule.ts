/**
 * Doctors rescheduling their own appointments, governed by the clinic setting
 * "Doctors manage their own schedule":
 *   ON  → the doctor moves the appointment directly.
 *   OFF → the doctor sends a request; reception approves (moves it) or rejects.
 */
import { and, asc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { rescheduleRequests } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { BookingError, getAppointment, getSettings, moveAppointment } from "@/lib/booking/engine";
import { MOVABLE_STATUSES } from "@/lib/booking/status";

export async function doctorReschedule(
  tx: TenantTx,
  actor: Actor,
  input: { appointmentId: string; startsAt: Date; reason?: string },
) {
  assertCan(actor.roles, "appointments:own");
  const appt = await getAppointment(tx, input.appointmentId, true);
  if (appt.practitionerId !== actor.memberId) throw new BookingError("not_allowed");
  if (!MOVABLE_STATUSES.includes(appt.status)) throw new BookingError("bad_status");
  const settings = await getSettings(tx);

  if (settings.doctorsManageOwnSchedule) {
    const moved = await moveAppointment(tx, actor, appt.id, { startsAt: input.startsAt });
    return { mode: "moved" as const, appointment: moved };
  }

  const [request] = await tx
    .insert(rescheduleRequests)
    .values({
      tenantId: actor.tenantId,
      branchId: appt.branchId,
      appointmentId: appt.id,
      requestedBy: actor.userId,
      proposedStartsAt: input.startsAt,
      reason: input.reason?.trim() || null,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "reschedule.request",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { requestId: request.id, to: input.startsAt.toISOString() },
  });
  return { mode: "requested" as const, request };
}

export async function decideRequest(
  tx: TenantTx,
  actor: Actor,
  input: { requestId: string; approve: boolean; note?: string },
) {
  assertCan(actor.roles, "requests:decide");
  const [req] = await tx
    .select()
    .from(rescheduleRequests)
    .where(eq(rescheduleRequests.id, input.requestId))
    .for("update")
    .limit(1);
  if (!req) throw new BookingError("not_found");
  if (req.status !== "pending") return req; // already decided: idempotent

  // Approving actually moves the appointment; if the slot is gone, this throws and nothing changes.
  if (input.approve)
    await moveAppointment(tx, actor, req.appointmentId, { startsAt: req.proposedStartsAt });

  const [decided] = await tx
    .update(rescheduleRequests)
    .set({
      status: input.approve ? "approved" : "rejected",
      decidedBy: actor.userId,
      decidedAt: new Date(),
      decisionNote: input.note?.trim() || null,
    })
    .where(eq(rescheduleRequests.id, req.id))
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: input.approve ? "reschedule.approve" : "reschedule.reject",
    entityType: "appointment",
    entityId: req.appointmentId,
    metadata: { requestId: req.id },
  });
  return decided;
}

export async function pendingRequests(tx: TenantTx) {
  return tx
    .select()
    .from(rescheduleRequests)
    .where(and(eq(rescheduleRequests.status, "pending")))
    .orderBy(asc(rescheduleRequests.createdAt));
}
