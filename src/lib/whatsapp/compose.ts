/**
 * Everything a message about an appointment can say, as placeholder values ({date}, {doctor}…),
 * in the patient's language. The clinic setting "show service name in WhatsApp messages" decides
 * whether {appointment} names the service ("موعد بوتوكس") or not ("موعدك").
 */
import { eq } from "drizzle-orm";
import { appointments, branches, patients, services, tenantMembers, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { getSettings } from "@/lib/booking/engine";
import { consentStatusFor } from "@/lib/consents/consents";
import { formatGregorian, formatTime } from "@/lib/format";
import { consentSignUrl, videoJoinUrl } from "@/lib/video/link";

export type Lang = "ar" | "en";

export async function loadAppointmentContext(tx: TenantTx, appointmentId: string) {
  const [row] = await tx
    .select({ a: appointments, p: patients, s: services, b: branches })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .where(eq(appointments.id, appointmentId))
    .limit(1);
  if (!row) return null;
  const [doctor] = await tx
    .select({ nameAr: users.name, nameEn: users.nameEn })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(tenantMembers.id, row.a.practitionerId));
  const settings = await getSettings(tx);
  const consent = (
    await consentStatusFor(tx, [{ id: row.a.id, patientId: row.p.id, serviceId: row.s.id }])
  ).get(row.a.id);
  return {
    appointment: row.a,
    patient: row.p,
    service: row.s,
    branch: row.b,
    doctor: doctor ?? { nameAr: "", nameEn: null },
    showService: settings.showServiceInMessages,
    consentUnsigned: !!consent && !consent.signed,
  };
}

export type AppointmentContext = NonNullable<Awaited<ReturnType<typeof loadAppointmentContext>>>;

export const firstName = (full: string) => full.trim().split(/\s+/)[0] ?? "";

/** "موعد بوتوكس" / "your Botox appointment", or "موعدك" / "your appointment" when hidden. */
export function appointmentPhrase(serviceName: string, lang: Lang, showService: boolean) {
  if (!showService) return lang === "ar" ? "موعدك" : "your appointment";
  return lang === "ar" ? `موعد ${serviceName}` : `your ${serviceName} appointment`;
}

export function appointmentVars(
  ctx: AppointmentContext,
  lang: Lang,
  baseUrl: string,
  startsAt: Date = ctx.appointment.startsAt,
): Record<string, string> {
  const en = lang === "en";
  const serviceName = en ? ctx.service.nameEn : ctx.service.nameAr;
  const myLink = `${baseUrl}/my`;
  const signLink = consentSignUrl(baseUrl, ctx.appointment.tenantId, ctx.appointment.id);
  const preVisit = en ? ctx.service.preVisitEn : ctx.service.preVisitAr;
  // Video consultation: the join link takes the place of the map, and leads the instructions.
  const video = ctx.service.isVirtual
    ? videoJoinUrl(baseUrl, ctx.appointment.tenantId, ctx.appointment.id)
    : null;
  const videoLine = video
    ? en
      ? `Join your video consultation here (opens 15 minutes before): ${video}`
      : `رابط الاستشارة المرئية (يفتح قبل الموعد بـ15 دقيقة): ${video}`
    : "";
  const instructions = [
    videoLine,
    preVisit ? (en ? `Before your visit: ${preVisit}` : preVisit) : "",
  ]
    .filter(Boolean)
    .join("\n");
  return {
    patient_first_name: firstName(
      en && ctx.patient.fullNameEn ? ctx.patient.fullNameEn : ctx.patient.fullNameAr,
    ),
    appointment: appointmentPhrase(serviceName, lang, ctx.showService),
    service: ctx.showService ? serviceName : en ? "your appointment" : "موعدك",
    date: formatGregorian(startsAt, lang, "full"),
    time: formatTime(startsAt, lang),
    doctor: en && ctx.doctor.nameEn ? ctx.doctor.nameEn : ctx.doctor.nameAr,
    branch: en ? ctx.branch.nameEn : ctx.branch.nameAr,
    map_link: video ?? ctx.branch.mapUrl ?? baseUrl,
    my_link: myLink,
    booking_link: `${baseUrl}/book`,
    instructions,
    // A signed link straight to this visit's consent (no code, no sign-in).
    consent_note: ctx.consentUnsigned
      ? en
        ? `Please sign your consent form before the visit: ${signLink}`
        : `فضلًا وقّع نموذج الموافقة قبل الزيارة: ${signLink}`
      : "",
  };
}
