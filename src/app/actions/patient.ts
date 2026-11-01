"use server";

/**
 * Actions for the PUBLIC pages: online booking (/book) and the patient page (/my).
 * No staff login here: a visitor proves their mobile with a code; the patient page uses a short
 * patient session. All booking goes through the booking engine.
 */
import { revalidatePath } from "next/cache";
import { cookies, headers } from "next/headers";
import { asc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { patients } from "@/db/schema";
import {
  bookOnline,
  cancelByPatient,
  findOnlineSlots,
  getAppointment,
  moveByPatient,
  patientFamilyIds,
} from "@/lib/booking/engine";
import { signConsentByPatient } from "@/lib/consents/consents";
import { isDay } from "@/lib/booking/time";
import { parse, publicAction, PublicError } from "@/lib/actions";
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
import { clientIp } from "@/lib/request-info";
import { checkCode, sendCode } from "@/lib/verify/codes";

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

const bookingConfirm = bookingRequest.extend({ code: z.string().trim().max(10) });

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
    const result = await withTenant(tenant.id, async (tx) => {
      const check = await checkCode(tx, {
        tenantId: tenant.id,
        phone: v.phone,
        purpose: "booking",
        code: westernDigits(v.code),
      });
      // Return (not throw) so the counted attempt is saved.
      if (!check.ok) return { error: check.error };
      const { patient } = await findOrCreateOnlinePatient(tx, {
        tenantId: tenant.id,
        filePrefix: tenant.slug.charAt(0).toUpperCase(),
        phone: v.phone,
        fullName: v.fullName,
        gender: v.patientGender,
      });
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
  });
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
  });
}

export async function portalSignOutAction() {
  return publicAction(async (tenant) => {
    const jar = await cookies();
    await revokePatientSession(tenant.id, jar.get(PATIENT_COOKIE)?.value);
    jar.delete(PATIENT_COOKIE);
    return null;
  });
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

/** Free times for moving an appointment (same doctor, same service). */
export async function portalSlotsAction(input: { appointmentId: string; day: string }) {
  return publicAction(async (tenant) => {
    const v = parse(z.object({ appointmentId: uuid, day: z.string().refine(isDay) }), input);
    const patientId = await requirePatient(tenant.id);
    return withTenant(tenant.id, async (tx) => {
      const appt = await getAppointment(tx, v.appointmentId);
      if (!(await patientFamilyIds(tx, patientId)).includes(appt.patientId)) {
        throw new PublicError("not_found");
      }
      const slots = await findOnlineSlots(tx, {
        branchId: appt.branchId,
        serviceId: appt.serviceId,
        practitionerId: appt.practitionerId,
        day: v.day,
      });
      return slots.map((s) => s.startsAt.toISOString());
    });
  });
}

export async function portalMoveAction(input: { appointmentId: string; startsAt: string }) {
  return publicAction(async (tenant) => {
    const v = parse(
      z.object({ appointmentId: uuid, startsAt: z.string().datetime({ offset: true }) }),
      input,
    );
    const patientId = await requirePatient(tenant.id);
    await withTenant(tenant.id, (tx) =>
      moveByPatient(tx, {
        patientId,
        appointmentId: v.appointmentId,
        startsAt: new Date(v.startsAt),
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
    const c = await withTenant(tenant.id, (tx) =>
      signConsentByPatient(tx, {
        tenantId: tenant.id,
        sessionPatientId,
        patientId: v.patientId,
        templateId: v.templateId,
        appointmentId: v.appointmentId ?? null,
        signerName: v.signerName,
        signaturePng: png,
        userAgent,
      }),
    );
    revalidatePath("/my");
    return { id: c.id };
  });
}
