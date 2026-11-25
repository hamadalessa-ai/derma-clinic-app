"use server";

/**
 * Actions for the PUBLIC pages: online booking (/book) and the patient page (/my).
 * No staff login here: a visitor proves their mobile with a code; the patient page uses a short
 * patient session. All booking goes through the booking engine.
 */
import { planAllows } from "@/lib/platform/plans";
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant, type TenantTx } from "@/db/tenant";
import { getLocale } from "next-intl/server";
import { audit } from "@/lib/audit";
import { appointments, patients } from "@/db/schema";
import {
  bookOnline,
  cancelByPatient,
  findOnlineSlots,
  moveByPatient,
  patientFamilyIds,
  rescheduleOptions,
} from "@/lib/booking/engine";
import { doctorNames } from "@/lib/booking/doctor-names";
import { signConsentByLink, signConsentByPatient } from "@/lib/consents/consents";
import { isDay } from "@/lib/booking/time";
import { parse, publicAction, PublicError, PAUSED_OK } from "@/lib/actions";
import type { Tenant } from "@/lib/tenant/current";
import { findOrCreateOnlinePatient } from "@/lib/patients/queries";
import { normalizeSaudiMobile, westernDigits } from "@/lib/phone";
import {
  createPatientSession,
  PATIENT_COOKIE,
  PATIENT_SESSION_MINUTES,
  patientForToken,
  revokePatientSession,
} from "@/lib/portal/session";
import { notifyLater } from "@/lib/push/notify";
import { whatsappLater } from "@/lib/whatsapp/later";
import { sendBookingConfirmation } from "@/lib/whatsapp/outbox";
import { sendMessage } from "@/lib/whatsapp/send";
import { appBaseUrl } from "@/lib/whatsapp/config";
import { consentSignUrl } from "@/lib/video/link";
import {
  checkInAfterConsent,
  selfCheckIn,
  type SelfCheckInResult,
} from "@/lib/visits/self-check-in";
import { clientIp } from "@/lib/request-info";
import { checkCode, sendCode } from "@/lib/verify/codes";
import { BOOKING_PASS_COOKIE, BOOKING_PASS_MINUTES, phonePass } from "@/lib/verify/pass";
import { adultByPhone, verifiedPhone } from "@/lib/verify/identity";
import { videoProvider } from "@/lib/video/provider";
import { patientJoin, VideoVisitError } from "@/lib/video/visit";
import { parseConsentToken } from "@/lib/video/link";

const uuid = z.string().uuid();
const gender = z.enum(["male", "female"]);
const phone = z
  .string()
  .max(30)
  .transform((v, ctx) => {
    const n = normalizeSaudiMobile(v);
    if (!n) ctx.addIssue({ code: "custom", message: "bad phone" });
    return n ?? "";
  });

const slotQuery = z.object({
  branchId: uuid,
  serviceId: uuid,
  day: z.string().refine(isDay),
  practitionerId: uuid.nullish(),
  gender: gender.nullish(),
});

/** Free times for one day (online rules applied). */
export async function onlineSlotsAction(input: z.input<typeof slotQuery>) {
  return publicAction(async (tenant) => {
    const v = parse(slotQuery, input);
    const slots = await withTenant(tenant.id, (tx) => findOnlineSlots(tx, v));
    return slots.map((s) => ({
      startsAt: s.startsAt.toISOString(),
      practitionerId: s.practitionerId,
    }));
  });
}

const bookingRequest = z.object({
  branchId: uuid,
  serviceId: uuid,
  practitionerId: uuid.nullish(),
  gender: gender.nullish(),
  startsAt: z.string().datetime({ offset: true }),
  fullName: z.string().trim().min(3).max(80),
  phone,
  patientGender: gender,
  /** Honeypot: hidden from people; bots fill it in. */
  website: z.string().max(200).optional(),
  /** The patient ticked "send me confirmations and reminders on WhatsApp". */
  whatsappOptIn: z.boolean().optional(),
});

/** Step 1 of confirming: sends a code to the mobile (in demo mode: shows it on screen). */
export async function requestBookingCodeAction(input: z.input<typeof bookingRequest>) {
  return publicAction(async (tenant) => {
    const v = parse(bookingRequest, input);
    // A bot filled the hidden field: answer like a success, do nothing.
    if (v.website) return { demoCode: null as string | null };
    const ip = await clientIp();
    return withTenant(tenant.id, (tx) =>
      sendCode(tx, { tenant, phone: v.phone, purpose: "booking", ip }),
    );
  });
}

/** The code is optional when the mobile was verified first (booking pass) or the patient is signed in. */
const bookingConfirm = bookingRequest.extend({ code: z.string().trim().max(10).optional() });

const phoneOnly = z.object({ phone, website: z.string().max(200).optional() });

/** Booking step 1: a code to the mobile (in demo mode: shown on screen). */
export async function requestPhoneCodeAction(input: z.input<typeof phoneOnly>) {
  return publicAction(async (tenant) => {
    const v = parse(phoneOnly, input);
    if (v.website) return { demoCode: null as string | null };
    const ip = await clientIp();
    return withTenant(tenant.id, (tx) =>
      sendCode(tx, { tenant, phone: v.phone, purpose: "booking", ip }),
    );
  });
}

/**
 * Booking step 2: the code is right → this browser holds a 30-minute "verified mobile" pass; the
 * patient then chooses service and time and confirms without another code. Known patients get
 * their name pre-filled.
 */
export async function verifyBookingPhoneAction(input: { phone: string; code: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ phone, code: z.string().trim().max(10) }), input);
    const result = await withTenant(tenant.id, async (tx) => {
      const check = await checkCode(tx, {
        tenantId: tenant.id,
        phone: v.phone,
        purpose: "booking",
        code: westernDigits(v.code),
      });
      if (!check.ok) return { error: check.error as string };
      return { known: await adultByPhone(tx, v.phone) };
    });
    if (result.error) throw new PublicError(result.error);
    (await cookies()).set(BOOKING_PASS_COOKIE, phonePass(tenant.id, v.phone), {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: BOOKING_PASS_MINUTES * 60,
    });
    return { phone: v.phone, known: result.known ?? null };
  });
}

/**
 * Step 2: checks the code, finds (or creates) the patient by mobile, books through the engine and
 * signs the patient in to the patient page. A wrong code is counted; if the time was taken in the
 * meantime, nothing is kept (the same code can be used again with another time).
 */
export async function confirmBookingAction(input: z.input<typeof bookingConfirm>) {
  return publicAction(async (tenant) => {
    const v = parse(bookingConfirm, input);
    if (v.website) throw new PublicError("code_expired");
    const ip = await clientIp();
    // Verified first (pass / signed-in patient) → no code needed, but only for THAT mobile.
    const preVerified = !v.code && (await verifiedPhone(tenant.id)) === v.phone;
    if (!v.code && !preVerified) throw new PublicError("code_expired");
    const result = await withTenant(tenant.id, async (tx) => {
      if (!preVerified) {
        const check = await checkCode(tx, {
          tenantId: tenant.id,
          phone: v.phone,
          purpose: "booking",
          code: westernDigits(v.code ?? ""),
        });
        // Return (not throw) so the counted attempt is saved.
        if (!check.ok) return { error: check.error };
      }
      const { patient } = await findOrCreateOnlinePatient(tx, {
        tenantId: tenant.id,
        filePrefix: tenant.slug.charAt(0).toUpperCase(),
        phone: v.phone,
        fullName: v.fullName,
        gender: v.patientGender,
      });
      await recordWhatsappChoice(tx, patient.id, !!v.whatsappOptIn, await getLocale());
      const appt = await bookOnline(tx, {
        tenantId: tenant.id,
        branchId: v.branchId,
        serviceId: v.serviceId,
        patientId: patient.id,
        startsAt: new Date(v.startsAt),
        practitionerId: v.practitionerId,
        gender: v.gender,
      });
      const session = await createPatientSession(tx, {
        tenantId: tenant.id,
        patientId: patient.id,
        ip,
      });
      return { appt, session };
    });
    if (result.error) throw new PublicError(result.error);
    setPatientCookie(await cookies(), result.session.token);
    notifyLater(tenant.id, [
      { type: "new_booking", appointmentId: result.appt.id },
      { type: "online_booking", appointmentId: result.appt.id },
    ]);
    whatsappLater(() => sendBookingConfirmation(tenant, result.appt.id));
    return {
      appointmentId: result.appt.id,
      status: result.appt.status,
      startsAt: result.appt.startsAt.toISOString(),
      practitionerId: result.appt.practitionerId,
    };
  });
}

// ─── Patient page (/my) ─────────────────────────────────────────────────────

const PNG_DATA_URL = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/;

function setPatientCookie(jar: Awaited<ReturnType<typeof cookies>>, token: string) {
  jar.set(PATIENT_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: PATIENT_SESSION_MINUTES * 60,
  });
}

/** The signed-in patient for this request, or a "signed out" refusal. */
async function requirePatient(tenantId: string) {
  const token = (await cookies()).get(PATIENT_COOKIE)?.value;
  const s = await patientForToken(tenantId, token);
  if (!s) throw new PublicError("patient_signed_out");
  return s.patientId;
}

const portalCodeRequest = z.object({ phone, website: z.string().max(200).optional() });

/** Sign-in step 1: a code to the mobile. Always answers the same, whether or not there is a file. */
export async function requestPortalCodeAction(input: z.input<typeof portalCodeRequest>) {
  return publicAction(async (tenant) => {
    const v = parse(portalCodeRequest, input);
    if (v.website) return { demoCode: null as string | null };
    const ip = await clientIp();
    return withTenant(tenant.id, (tx) =>
      sendCode(tx, { tenant, phone: v.phone, purpose: "portal", ip }),
    );
  }, PAUSED_OK);
}

const portalCodeCheck = z.object({ phone, code: z.string().trim().max(10) });

/** Sign-in step 2: checks the code and opens a 30-minute patient session. */
export async function verifyPortalCodeAction(input: z.input<typeof portalCodeCheck>) {
  return publicAction(async (tenant) => {
    const v = parse(portalCodeCheck, input);
    const ip = await clientIp();
    const result = await withTenant(tenant.id, async (tx) => {
      const check = await checkCode(tx, {
        tenantId: tenant.id,
        phone: v.phone,
        purpose: "portal",
        code: westernDigits(v.code),
      });
      if (!check.ok) return { error: check.error as string };
      // The adult with this mobile (a family may share one number).
      const [patient] = await tx
        .select({ id: patients.id })
        .from(patients)
        .where(eq(patients.phone, v.phone))
        .orderBy(sql`${patients.guardianId} is not null`, asc(patients.createdAt))
        .limit(1);
      if (!patient) return { error: "no_patient_file" };
      return {
        session: await createPatientSession(tx, { tenantId: tenant.id, patientId: patient.id, ip }),
      };
    });
    if (result.error || !result.session) throw new PublicError(result.error ?? "unexpected");
    setPatientCookie(await cookies(), result.session.token);
    return null;
  }, PAUSED_OK);
}

export async function portalSignOutAction() {
  return publicAction(async (tenant) => {
    const jar = await cookies();
    await revokePatientSession(tenant.id, jar.get(PATIENT_COOKIE)?.value);
    jar.delete(PATIENT_COOKIE);
    return null;
  }, PAUSED_OK);
}

export async function portalCancelAction(input: { appointmentId: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ appointmentId: uuid }), input);
    const patientId = await requirePatient(tenant.id);
    await withTenant(tenant.id, (tx) =>
      cancelByPatient(tx, { patientId, appointmentId: v.appointmentId }),
    );
    revalidatePath("/my");
    notifyLater(tenant.id, [
      { type: "cancelled", appointmentId: v.appointmentId },
      { type: "patient_cancelled", appointmentId: v.appointmentId },
    ]);
    return null;
  });
}

/**
 * Where an appointment can move on a day: the same doctor's free times, other doctors' free times,
 * or the reason it can't move online (e.g. within the cancellation window) — never a silent "full".
 */
export async function portalSlotsAction(input: { appointmentId: string; day: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ appointmentId: uuid, day: z.string().refine(isDay) }), input);
    const patientId = await requirePatient(tenant.id);
    return withTenant(tenant.id, async (tx) => {
      const r = await rescheduleOptions(tx, { ...v, patientId });
      if (!r.ok) return r;
      const names = await doctorNames(tx, [
        r.practitionerId,
        ...r.otherDoctors.map((d) => d.practitionerId),
      ]);
      const iso = (slots: { startsAt: Date }[]) => slots.map((s) => s.startsAt.toISOString());
      return {
        ok: true as const,
        doctor: names.get(r.practitionerId) ?? null,
        sameDoctor: iso(r.sameDoctor),
        otherDoctors: r.otherDoctors.map((d) => ({
          practitionerId: d.practitionerId,
          doctor: names.get(d.practitionerId) ?? null,
          slots: iso(d.slots),
        })),
      };
    });
  });
}

export async function portalMoveAction(input: {
  appointmentId: string;
  startsAt: string;
  practitionerId?: string;
}) {
  return publicAction(async (tenant) => {
    const v = parse(
      z.object({
        appointmentId: uuid,
        startsAt: z.string().datetime({ offset: true }),
        practitionerId: uuid.optional(),
      }),
      input,
    );
    const patientId = await requirePatient(tenant.id);
    await withTenant(tenant.id, (tx) =>
      moveByPatient(tx, {
        patientId,
        appointmentId: v.appointmentId,
        startsAt: new Date(v.startsAt),
        practitionerId: v.practitionerId,
      }),
    );
    revalidatePath("/my");
    notifyLater(tenant.id, [
      { type: "rescheduled", appointmentId: v.appointmentId },
      { type: "patient_rescheduled", appointmentId: v.appointmentId },
    ]);
    return null;
  });
}

const portalSign = z.object({
  patientId: uuid,
  templateId: uuid,
  appointmentId: uuid.nullish(),
  signerName: z.string().trim().min(2).max(120),
  signatureDataUrl: z.string().max(3_000_000).regex(PNG_DATA_URL),
});

/** Signs a consent before the visit. Reception then sees "already signed" at check-in. */
export async function portalSignConsentAction(input: z.input<typeof portalSign>) {
  return publicAction(async (tenant) => {
    const v = parse(portalSign, input);
    const sessionPatientId = await requirePatient(tenant.id);
    const png = Buffer.from(v.signatureDataUrl.match(PNG_DATA_URL)![1], "base64");
    const userAgent = (await headers()).get("user-agent");
    const { c, arrival } = await withTenant(tenant.id, async (tx) => {
      const c = await signConsentByPatient(tx, {
        tenantId: tenant.id,
        sessionPatientId,
        patientId: v.patientId,
        templateId: v.templateId,
        appointmentId: v.appointmentId ?? null,
        signerName: v.signerName,
        signaturePng: png,
        userAgent,
      });
      // They had said "I've arrived": signing checks them in.
      const arrival = v.appointmentId
        ? await checkInAfterConsent(tx, { tenantId: tenant.id, appointmentId: v.appointmentId })
        : null;
      return { c, arrival };
    });
    afterArrival(tenant, arrival);
    revalidatePath("/my");
    return { id: c.id, checkedIn: arrival?.status === "checked_in" };
  });
}

/**
 * The patient's WhatsApp choice (online booking tick box, or /my): ticked = agreed (source + time
 * recorded); not ticked = nothing changes (an earlier "yes" stays until they say STOP or untick on /my).
 * Their language for messages is the page language they used.
 */
async function recordWhatsappChoice(
  tx: TenantTx,
  patientId: string,
  optIn: boolean,
  locale: string,
  source: "online" | "patient_page" = "online",
) {
  const language = locale === "en" ? "en" : "ar";
  if (!optIn && source === "online") {
    await tx
      .update(patients)
      .set({ preferredLanguage: language })
      .where(eq(patients.id, patientId));
    return;
  }
  await tx
    .update(patients)
    .set(
      optIn
        ? {
            whatsappOptInAt: sql`now()`,
            whatsappOptInSource: source,
            whatsappOptedOutAt: null,
            preferredLanguage: language,
          }
        : { whatsappOptedOutAt: sql`now()`, preferredLanguage: language },
    )
    .where(eq(patients.id, patientId));
  await audit(tx, {
    actorUserId: null,
    action: optIn ? "whatsapp.opt_in" : "whatsapp.opt_out",
    entityType: "patient",
    entityId: patientId,
    metadata: { source, language },
  });
}

/** /my: the patient switches WhatsApp messages on or off for themselves. */
export async function portalWhatsappAction(input: { optIn: boolean }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ optIn: z.boolean() }), input);
    const patientId = await requirePatient(tenant.id);
    const locale = await getLocale();
    await withTenant(tenant.id, (tx) =>
      recordWhatsappChoice(tx, patientId, v.optIn, locale, "patient_page"),
    );
    revalidatePath("/my");
    return null;
  });
}

/**
 * The patient joins their video consultation from the WhatsApp link (/visit/<token>).
 * The signed token decides which appointment; the time window and consent are checked inside.
 */
export async function joinVideoAsPatientAction(input: { token: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ token: z.string().min(40).max(80) }), input);
    const lang = (await getLocale()) === "en" ? "en" : "ar";
    if (!planAllows(tenant, "video")) throw new VideoVisitError("not_in_plan");
    return patientJoin(tenant.id, v.token, { provider: videoProvider(), lang });
  });
}

/** Signs this visit's consent from the signed WhatsApp link (/sign/<token>): no code needed. */
export async function signConsentByLinkAction(input: {
  token: string;
  signerName: string;
  signatureDataUrl: string;
}) {
  return publicAction(async (tenant) => {
    const v = parse(
      z.object({
        token: z.string().min(40).max(80),
        signerName: z.string().trim().min(2).max(120),
        signatureDataUrl: z.string().max(3_000_000).regex(PNG_DATA_URL),
      }),
      input,
    );
    const appointmentId = parseConsentToken(tenant.id, v.token);
    if (!appointmentId) throw new PublicError("not_found");
    const png = Buffer.from(v.signatureDataUrl.match(PNG_DATA_URL)![1], "base64");
    const userAgent = (await headers()).get("user-agent");
    const { c, arrival } = await withTenant(tenant.id, async (tx) => {
      const c = await signConsentByLink(tx, {
        tenantId: tenant.id,
        appointmentId,
        signerName: v.signerName,
        signaturePng: png,
        userAgent,
      });
      // They had tapped "I've arrived" on WhatsApp: signing checks them in.
      const arrival = await checkInAfterConsent(tx, { tenantId: tenant.id, appointmentId });
      return { c, arrival };
    });
    afterArrival(tenant, arrival);
    return { id: c.id, checkedIn: arrival?.status === "checked_in" };
  });
}

/** After a self check-in: tell the doctor (push) and the patient (WhatsApp, if they use it). */
function afterArrival(tenant: Tenant, arrival: SelfCheckInResult | null) {
  if (arrival?.status !== "checked_in") return;
  notifyLater(tenant.id, [{ type: "checked_in", appointmentId: arrival.appointmentId }]);
  whatsappLater(async () => {
    const [a] = await withTenant(tenant.id, (tx) =>
      tx
        .select({ patientId: appointments.patientId })
        .from(appointments)
        .where(eq(appointments.id, arrival.appointmentId)),
    );
    if (!a) return;
    await sendMessage(tenant, {
      kind: "checked_in_ack",
      patientId: a.patientId,
      appointmentId: arrival.appointmentId,
      vars: {},
      dedupeKey: `checked_in_ack:${arrival.appointmentId}`,
    });
  });
}

/**
 * The patient page's "I've arrived" (self check-in) for their own or a family member's visit
 * today. A missing consent comes back as its signing link; signing it checks them in.
 */
export async function portalArrivedAction(input: { appointmentId: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ appointmentId: uuid }), input);
    const patientId = await requirePatient(tenant.id);
    const result = await withTenant(tenant.id, async (tx) =>
      selfCheckIn(tx, {
        tenantId: tenant.id,
        appointmentId: v.appointmentId,
        patientIds: await patientFamilyIds(tx, patientId),
        via: "online",
      }),
    );
    afterArrival(tenant, result);
    revalidatePath("/my");
    if (result.status === "consent_required") {
      return {
        status: result.status,
        signUrl: consentSignUrl(appBaseUrl(tenant), tenant.id, v.appointmentId),
      };
    }
    if (result.status === "too_early") {
      return { status: result.status, minutes: result.beforeMinutes };
    }
    return { status: result.status };
  });
}
