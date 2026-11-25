/**
 * Self check-in: the patient says "I've arrived" from WhatsApp (the button in the visit-day
 * message) or from their patient page. The same steps as check-in at the desk, run by the system:
 * consent signed → package session (or included membership visit) used once → "arrived".
 *
 *  - Only the patient's own (or their family's) visit today, inside the clinic's window
 *    (default from 45 minutes before the start until 30 minutes after), clinic visits only.
 *  - A consent still missing: the arrival is remembered (arrival_requested_at) and the patient
 *    gets the consent link; signing it checks them in (checkInAfterConsent).
 *  - Staff then "Call in" the patient (lib/visits/call-in.ts); the room goes out on WhatsApp.
 */
import { eq } from "drizzle-orm";
import { services, tenantSettings } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import {
  getAppointment,
  markArrivalRequested,
  markArrivedByPatient,
  type Appointment,
} from "@/lib/booking/engine";
import { missingConsent, type ConsentTemplate } from "@/lib/consents/consents";
import { takeIncludedVisit } from "@/lib/memberships/memberships";
import { deductForAppointment } from "@/lib/packages/packages";

const MINUTE = 60_000;
/** How long an "I've arrived" waits for the consent to be signed. */
export const ARRIVAL_REQUEST_VALID_MINUTES = 120;

export interface SelfCheckInSettings {
  enabled: boolean;
  beforeMinutes: number;
  afterMinutes: number;
}

export async function selfCheckInSettings(tx: TenantTx): Promise<SelfCheckInSettings> {
  const [s] = await tx
    .select({
      enabled: tenantSettings.selfCheckInEnabled,
      beforeMinutes: tenantSettings.selfCheckInBeforeMinutes,
      afterMinutes: tenantSettings.selfCheckInAfterMinutes,
    })
    .from(tenantSettings);
  return s ?? { enabled: false, beforeMinutes: 45, afterMinutes: 30 };
}

export type WindowState = "open" | "too_early" | "too_late";

/** Is "now" inside the self check-in window of this visit? */
export function windowState(
  startsAt: Date,
  settings: SelfCheckInSettings,
  now: Date = new Date(),
): WindowState {
  if (now.getTime() < startsAt.getTime() - settings.beforeMinutes * MINUTE) return "too_early";
  if (now.getTime() > startsAt.getTime() + settings.afterMinutes * MINUTE) return "too_late";
  return "open";
}

/** For the patient page: show the "I've arrived" button on this visit now? */
export function canOfferSelfCheckIn(
  appt: Pick<Appointment, "status" | "startsAt">,
  isVirtual: boolean,
  settings: SelfCheckInSettings,
  now: Date = new Date(),
) {
  return (
    settings.enabled &&
    !isVirtual &&
    (appt.status === "booked" || appt.status === "confirmed") &&
    windowState(appt.startsAt, settings, now) === "open"
  );
}

export type SelfCheckInResult =
  | { status: "checked_in"; appointmentId: string }
  | { status: "already_checked_in"; appointmentId: string }
  | { status: "consent_required"; appointmentId: string; template: ConsentTemplate }
  | { status: "too_early"; appointmentId: string; startsAt: Date; beforeMinutes: number }
  | { status: "too_late"; appointmentId: string }
  | { status: "off" | "video" | "not_found" };

export async function selfCheckIn(
  tx: TenantTx,
  input: {
    tenantId: string;
    appointmentId: string;
    /** The patients the person may act for (themselves + family). */
    patientIds: string[];
    via: "whatsapp" | "online";
    now?: Date;
  },
): Promise<SelfCheckInResult> {
  const now = input.now ?? new Date();
  // Row lock: a second tap waits here, then sees "arrived".
  const appt = await getAppointment(tx, input.appointmentId, true).catch(() => null);
  if (!appt || !input.patientIds.includes(appt.patientId)) return { status: "not_found" };
  const id = appt.id;
  if (["arrived", "in_session", "completed"].includes(appt.status)) {
    return { status: "already_checked_in", appointmentId: id };
  }
  if (appt.status !== "booked" && appt.status !== "confirmed") return { status: "not_found" };
  const settings = await selfCheckInSettings(tx);
  if (!settings.enabled) return { status: "off" };
  const [service] = await tx
    .select({ isVirtual: services.isVirtual })
    .from(services)
    .where(eq(services.id, appt.serviceId));
  if (service?.isVirtual) return { status: "video" };

  const state = windowState(appt.startsAt, settings, now);
  if (state === "too_early") {
    return {
      status: "too_early",
      appointmentId: id,
      startsAt: appt.startsAt,
      beforeMinutes: settings.beforeMinutes,
    };
  }
  if (state === "too_late") return { status: "too_late", appointmentId: id };

  const template = await missingConsent(tx, appt);
  if (template) {
    await markArrivalRequested(tx, id);
    await audit(tx, {
      actorUserId: null,
      action: "appointment.arrival_requested",
      entityType: "appointment",
      entityId: id,
      metadata: { via: input.via, consent: template.code },
    });
    return { status: "consent_required", appointmentId: id, template };
  }

  const system = { tenantId: input.tenantId, userId: null };
  const deduction = await deductForAppointment(tx, system, appt);
  const member = deduction.packageId ? null : await takeIncludedVisit(tx, system, appt);
  await markArrivedByPatient(tx, id, input.via);
  await audit(tx, {
    actorUserId: null,
    action: "appointment.check_in",
    entityType: "appointment",
    entityId: id,
    metadata: {
      via: input.via === "online" ? "patient_page" : "whatsapp",
      self: true,
      packageId: deduction.packageId,
      deducted: deduction.deducted,
      remaining: deduction.remaining,
      membershipVisit: !!member?.used,
    },
  });
  return { status: "checked_in", appointmentId: id };
}

/**
 * The consent this visit needed was just signed: if the patient had said "I've arrived" (within
 * the last 2 hours), check them in now. Does nothing otherwise.
 */
export async function checkInAfterConsent(
  tx: TenantTx,
  input: { tenantId: string; appointmentId: string; now?: Date },
): Promise<SelfCheckInResult | null> {
  const now = input.now ?? new Date();
  const appt = await getAppointment(tx, input.appointmentId).catch(() => null);
  if (!appt?.arrivalRequestedAt) return null;
  // The request's age on the real clock (it was stored with the real time); `now` is for the window.
  if (Date.now() - appt.arrivalRequestedAt.getTime() > ARRIVAL_REQUEST_VALID_MINUTES * MINUTE) {
    return null;
  }
  return selfCheckIn(tx, {
    tenantId: input.tenantId,
    appointmentId: appt.id,
    patientIds: [appt.patientId],
    via: "online",
    now,
  });
}
