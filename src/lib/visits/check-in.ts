/**
 * Check-in: consent → package deduction → "arrived". All in ONE transaction, and safe to
 * repeat: a second tap (or two receptionists at once) never deducts twice.
 */
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import {
  BookingError,
  changeStatus,
  getAppointment,
  markArrivedByVideo,
} from "@/lib/booking/engine";
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

  const template = await missingConsent(tx, appt);
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

/**
 * Video consultation: the patient joined the call, so they have "arrived" — the same steps as
 * check-in at the desk (consent signed → package session deducted once → arrived), done by the
 * system. Does nothing when already arrived/started, or when the consent is still missing.
 */
export async function videoCheckIn(tx: TenantTx, tenantId: string, appointmentId: string) {
  const appt = await getAppointment(tx, appointmentId, true);
  if (!["booked", "confirmed"].includes(appt.status)) return { status: "unchanged" as const };
  if (await missingConsent(tx, appt)) return { status: "unchanged" as const };
  const deduction = await deductForAppointment(tx, { tenantId, userId: null }, appt);
  await markArrivedByVideo(tx, appt.id);
  await audit(tx, {
    actorUserId: null,
    action: "appointment.check_in",
    entityType: "appointment",
    entityId: appt.id,
    metadata: {
      via: "video",
      packageId: deduction.packageId,
      deducted: deduction.deducted,
      remaining: deduction.remaining,
    },
  });
  return { status: "arrived" as const };
}
