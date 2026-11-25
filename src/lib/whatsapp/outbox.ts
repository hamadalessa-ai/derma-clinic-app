/**
 * The clinic's WhatsApp messages about appointments, each built from the appointment and sent
 * through sendMessage(). Each one has a dedupe key, so calling it twice never sends twice.
 */
import { eq } from "drizzle-orm";
import { labCases, patientMemberships, patients, rooms } from "@/db/schema";
import { atRiyadh } from "@/lib/booking/time";
import { formatGregorian } from "@/lib/format";
import { withTenant } from "@/db/tenant";
import { careUrl } from "@/lib/video/link";
import { appBaseUrl } from "./config";
import { appointmentVars, loadAppointmentContext, type Lang } from "./compose";
import { sendMessage, type SendOutcome, type Tenant } from "./send";

type Env = Record<string, string | undefined>;

async function context(tenant: Tenant, appointmentId: string) {
  return withTenant(tenant.id, (tx) => loadAppointmentContext(tx, appointmentId));
}

const langOf = (p: { preferredLanguage: string }): Lang =>
  p.preferredLanguage === "en" ? "en" : "ar";

const skipped = (reason: string): SendOutcome => ({ outcome: "skipped", reason });

/** "Your appointment is booked" — after any booking (reception, online, WhatsApp). */
/**
 * The "already sent?" keys of the scheduled messages — one place, so the scheduler can skip
 * what was sent before without trying again (send.ts still guarantees at most once).
 */
export const SCHEDULED_KEYS = {
  reminder: (appointmentId: string, startsAt: Date) =>
    `reminder:${appointmentId}:${startsAt.toISOString()}`,
  post_care: (appointmentId: string) => `post_care:${appointmentId}`,
  no_show: (appointmentId: string) => `no_show:${appointmentId}`,
  recall: (appointmentId: string) => `recall:${appointmentId}`,
  membership_renewal: (membershipId: string) => `membership_renewal:${membershipId}`,
  arrival_invite: (appointmentId: string, startsAt: Date) =>
    `arrival_invite:${appointmentId}:${startsAt.toISOString()}`,
};

export async function sendBookingConfirmation(
  tenant: Tenant,
  appointmentId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  if (ctx.appointment.status === "pending" || ctx.appointment.status === "cancelled") {
    return skipped("not_booked");
  }
  return sendMessage(
    tenant,
    {
      kind: "booking_confirmation",
      patientId: ctx.patient.id,
      appointmentId,
      vars: appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
      dedupeKey: `confirmation:${appointmentId}:${ctx.appointment.startsAt.toISOString()}`,
    },
    env,
  );
}

/** Reminder 24 hours before, with pre-visit instructions, unsigned-consent link and buttons. */
export async function sendReminder(tenant: Tenant, appointmentId: string, env: Env = process.env) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  return sendMessage(
    tenant,
    {
      kind: "reminder",
      patientId: ctx.patient.id,
      appointmentId,
      vars: appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
      buttons: [
        { action: "confirm", appointmentId },
        { action: "reschedule", appointmentId },
        { action: "cancel", appointmentId },
      ],
      // A moved appointment gets a fresh reminder for its new time.
      dedupeKey: SCHEDULED_KEYS.reminder(appointmentId, ctx.appointment.startsAt),
    },
    env,
  );
}

/**
 * The visit day: "When you reach the clinic, tap 'I've arrived'" (self check-in), with the consent
 * link when one is still needed. Clinic visits only; the scheduler sends it a few hours before.
 */
export async function sendArrivalInvite(
  tenant: Tenant,
  appointmentId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  if (ctx.service.isVirtual) return skipped("video");
  if (!["booked", "confirmed"].includes(ctx.appointment.status)) return skipped("not_booked");
  return sendMessage(
    tenant,
    {
      kind: "arrival_invite",
      patientId: ctx.patient.id,
      appointmentId,
      vars: appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
      buttons: [{ action: "arrived", appointmentId }],
      dedupeKey: SCHEDULED_KEYS.arrival_invite(appointmentId, ctx.appointment.startsAt),
    },
    env,
  );
}

/** "Call in": the room is ready — the room's name and the doctor. One message per call. */
export async function sendRoomCall(tenant: Tenant, appointmentId: string, env: Env = process.env) {
  const found = await withTenant(tenant.id, async (tx) => {
    const ctx = await loadAppointmentContext(tx, appointmentId);
    if (!ctx) return null;
    const [room] = await tx
      .select({ nameAr: rooms.nameAr, nameEn: rooms.nameEn })
      .from(rooms)
      .where(eq(rooms.id, ctx.appointment.roomId));
    return { ctx, room };
  });
  if (!found) return skipped("not_found");
  const { ctx, room } = found;
  if (!ctx.appointment.calledAt) return skipped("not_called");
  const lang = langOf(ctx.patient);
  const vars = appointmentVars(ctx, lang, appBaseUrl(tenant, env));
  return sendMessage(
    tenant,
    {
      kind: "room_call",
      patientId: ctx.patient.id,
      appointmentId,
      vars: {
        ...vars,
        room: room ? (lang === "en" ? room.nameEn || room.nameAr : room.nameAr) : "",
      },
      dedupeKey: `room_call:${appointmentId}:${ctx.appointment.calledAt.toISOString()}`,
    },
    env,
  );
}

/** "The doctor is running X minutes late" (one batch = one tap on the calendar). */
export async function sendRunningLate(
  tenant: Tenant,
  appointmentId: string,
  minutes: number,
  batchId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  return sendMessage(
    tenant,
    {
      kind: "running_late",
      patientId: ctx.patient.id,
      appointmentId,
      vars: {
        ...appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
        minutes: String(minutes),
      },
      dedupeKey: `running_late:${appointmentId}:${batchId}`,
    },
    env,
  );
}

/** Post-care check-in after a completed procedure (only services with a post-care question). */
export async function sendPostCare(tenant: Tenant, appointmentId: string, env: Env = process.env) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  const lang = langOf(ctx.patient);
  const question =
    lang === "en" ? ctx.service.postCareEn || ctx.service.postCareAr : ctx.service.postCareAr;
  if (!question) return skipped("no_post_care_text");
  return sendMessage(
    tenant,
    {
      kind: "post_care",
      patientId: ctx.patient.id,
      appointmentId,
      vars: { ...appointmentVars(ctx, lang, appBaseUrl(tenant, env)), question },
      buttons: [
        { action: "all_good", appointmentId },
        { action: "concern", appointmentId },
      ],
      dedupeKey: SCHEDULED_KEYS.post_care(appointmentId),
    },
    env,
  );
}

/**
 * At checkout: a link to the patient's after-visit instructions (medication, treatment plan,
 * next appointments). The message itself carries no medical details — only the signed link.
 */
export async function sendVisitInstructions(
  tenant: Tenant,
  appointmentId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  if (ctx.appointment.status !== "completed") return skipped("not_completed");
  const lang = langOf(ctx.patient);
  return sendMessage(
    tenant,
    {
      kind: "visit_instructions",
      patientId: ctx.patient.id,
      appointmentId,
      vars: {
        ...appointmentVars(ctx, lang, appBaseUrl(tenant, env)),
        care_link: careUrl(appBaseUrl(tenant, env), tenant.id, appointmentId, env),
      },
      dedupeKey: `visit_instructions:${appointmentId}`,
    },
    env,
  );
}

/** After a no-show: "we missed you", with a rebooking link. */
export async function sendNoShowFollowUp(
  tenant: Tenant,
  appointmentId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, appointmentId);
  if (!ctx) return skipped("not_found");
  return sendMessage(
    tenant,
    {
      kind: "no_show",
      patientId: ctx.patient.id,
      appointmentId,
      vars: appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
      dedupeKey: SCHEDULED_KEYS.no_show(appointmentId),
    },
    env,
  );
}

/** Recall (e.g. Botox after 4 months), based on the last completed visit for that service. */
export async function sendRecall(
  tenant: Tenant,
  lastAppointmentId: string,
  env: Env = process.env,
) {
  const ctx = await context(tenant, lastAppointmentId);
  if (!ctx) return skipped("not_found");
  return sendMessage(
    tenant,
    {
      kind: "recall",
      patientId: ctx.patient.id,
      appointmentId: lastAppointmentId,
      vars: appointmentVars(ctx, langOf(ctx.patient), appBaseUrl(tenant, env)),
      dedupeKey: SCHEDULED_KEYS.recall(lastAppointmentId),
    },
    env,
  );
}

/** The lab work's name in the patient's language (WhatsApp; the screens use messages/*.json). */
const LAB_WORK_NAME: Record<string, { ar: string; en: string }> = {
  crown: { ar: "التاج", en: "crown" },
  bridge: { ar: "الجسر", en: "bridge" },
  veneer: { ar: "الفينير", en: "veneers" },
  denture: { ar: "طقم الأسنان", en: "denture" },
  aligner: { ar: "التقويم الشفاف", en: "aligners" },
  night_guard: { ar: "الواقي الليلي", en: "night guard" },
  implant_part: { ar: "قطعة الزراعة", en: "implant part" },
  other: { ar: "العمل", en: "lab work" },
};

/**
 * "Your crown is back from the lab — book your fitting": sent when reception marks a lab case
 * received. Once per receipt (a remake received again sends again).
 */
export async function sendLabReady(tenant: Tenant, labCaseId: string, env: Env = process.env) {
  const row = await withTenant(tenant.id, async (tx) => {
    const [r] = await tx
      .select({ c: labCases, p: patients })
      .from(labCases)
      .innerJoin(patients, eq(patients.id, labCases.patientId))
      .where(eq(labCases.id, labCaseId));
    return r ?? null;
  });
  if (!row) return skipped("not_found");
  if (row.c.status !== "received" || !row.c.receivedAt) return skipped("not_received");
  const lang = langOf(row.p);
  const full = (lang === "en" && row.p.fullNameEn) || row.p.fullNameAr;
  const work = LAB_WORK_NAME[row.c.work] ?? LAB_WORK_NAME.other;
  return sendMessage(
    tenant,
    {
      kind: "lab_ready",
      patientId: row.p.id,
      vars: {
        patient_first_name: full.trim().split(/\s+/)[0] ?? "",
        work: work[lang],
        booking_link: `${appBaseUrl(tenant, env)}/book`,
      },
      dedupeKey: `lab_ready:${row.c.id}:${row.c.receivedAt.toISOString()}`,
    },
    env,
  );
}

/** "Your membership ends on …": a few days before a period ends (scheduler). Once per period. */
export async function sendMembershipRenewal(
  tenant: Tenant,
  membershipId: string,
  env: Env = process.env,
) {
  const row = await withTenant(tenant.id, async (tx) => {
    const [r] = await tx
      .select({ m: patientMemberships, p: patients })
      .from(patientMemberships)
      .innerJoin(patients, eq(patients.id, patientMemberships.patientId))
      .where(eq(patientMemberships.id, membershipId));
    return r ?? null;
  });
  if (!row) return skipped("not_found");
  if (row.m.cancelledAt) return skipped("cancelled");
  const lang = langOf(row.p);
  const full = (lang === "en" && row.p.fullNameEn) || row.p.fullNameAr;
  return sendMessage(
    tenant,
    {
      kind: "membership_renewal",
      patientId: row.p.id,
      vars: {
        patient_first_name: full.trim().split(/\s+/)[0] ?? "",
        plan_name: lang === "en" ? row.m.nameEn : row.m.nameAr,
        end_date: formatGregorian(atRiyadh(row.m.endsOn, "12:00"), lang, "full"),
      },
      dedupeKey: SCHEDULED_KEYS.membership_renewal(row.m.id),
    },
    env,
  );
}
