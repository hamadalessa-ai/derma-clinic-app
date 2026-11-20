/**
 * The clinic's WhatsApp messages about appointments, each built from the appointment and sent
 * through sendMessage(). Each one has a dedupe key, so calling it twice never sends twice.
 */
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
      dedupeKey: `reminder:${appointmentId}:${ctx.appointment.startsAt.toISOString()}`,
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
      dedupeKey: `post_care:${appointmentId}`,
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
      dedupeKey: `no_show:${appointmentId}`,
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
      dedupeKey: `recall:${lastAppointmentId}`,
    },
    env,
  );
}
