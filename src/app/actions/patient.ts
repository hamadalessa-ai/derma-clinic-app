"use server";

/**
 * Actions for the PUBLIC pages: online booking (/book) and the patient page (/my).
 * No staff login here: a visitor proves their mobile with a code; the patient page uses a short
 * patient session. All booking goes through the booking engine.
 */
import { cookies } from "next/headers";
import { z } from "zod";
import { withTenant } from "@/db/tenant";
import { bookOnline, findOnlineSlots } from "@/lib/booking/engine";
import { isDay } from "@/lib/booking/time";
import { parse, publicAction, PublicError } from "@/lib/actions";
import { findOrCreateOnlinePatient } from "@/lib/patients/queries";
import { normalizeSaudiMobile, westernDigits } from "@/lib/phone";
import {
  createPatientSession,
  PATIENT_COOKIE,
  PATIENT_SESSION_MINUTES,
} from "@/lib/portal/session";
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
    (await cookies()).set(PATIENT_COOKIE, result.session.token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: PATIENT_SESSION_MINUTES * 60,
    });
    return {
      appointmentId: result.appt.id,
      status: result.appt.status,
      startsAt: result.appt.startsAt.toISOString(),
      practitionerId: result.appt.practitionerId,
    };
  });
}
