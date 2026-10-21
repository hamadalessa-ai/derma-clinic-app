/**
 * Check-in: consent → package deduction → "arrived". All in ONE transaction, and safe to
 * repeat: a second tap (or two receptionists at once) never deducts twice.
 */
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { BookingError, changeStatus, getAppointment } from "@/lib/booking/engine";
import { missingConsent, type ConsentTemplate } from "@/lib/consents/consents";
import { deductForAppointment } from "@/lib/packages/packages";

export type CheckInResult =
  | { status: "consent_required"; template: ConsentTemplate }
  | { status: "already_checked_in" }
  | { status: "checked_in"; deducted: boolean; packageId: string | null; remaining: number | null };

export async function checkIn(
  tx: TenantTx,
  actor: Actor,
  appointmentId: string,
): Promise<CheckInResult> {
  assertCan(actor.roles, "appointments:manage");
  // Row lock: a simultaneous second check-in waits here, then sees "arrived".
  const appt = await getAppointment(tx, appointmentId, true);
  if (["arrived", "in_session", "completed"].includes(appt.status))
    return { status: "already_checked_in" };
  if (!["booked", "confirmed"].includes(appt.status)) throw new BookingError("bad_status");

  const template = await missingConsent(tx, appt.patientId, appt.serviceId);
  if (template) return { status: "consent_required", template };

  const deduction = await deductForAppointment(tx, actor, appt);
  await changeStatus(tx, actor, appt.id, "arrived", { viaCheckIn: true });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "appointment.check_in",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      packageId: deduction.packageId,
      deducted: deduction.deducted,
      remaining: deduction.remaining,
    },
  });
  return {
    status: "checked_in",
    deducted: deduction.deducted,
    packageId: deduction.packageId,
    remaining: deduction.remaining,
  };
}
