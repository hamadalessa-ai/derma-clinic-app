/**
 * What a staff push notification may say. It appears on a LOCK SCREEN, so it carries only:
 * the patient's initials, the service and the time. Never the full name, phone number, file
 * number, medical alerts or notes.
 */

/** The seeded demo device lives on this host: the sender skips it (it never receives anything). */
export const DEMO_PUSH_HOST = "push.invalid";

/** Doctor: about their own appointments. Reception: things they need to act on. */
export const DOCTOR_TYPES = [
  "new_booking",
  "cancelled",
  "rescheduled",
  "checked_in",
  "request_answered",
] as const;
export const RECEPTION_TYPES = [
  "online_booking",
  "patient_cancelled",
  "patient_rescheduled",
  "reschedule_request",
] as const;
/** Both the appointment's doctor AND that branch's reception (e.g. a WhatsApp "concern"). */
export const SHARED_TYPES = ["patient_concern"] as const;
export type PushType =
  (typeof DOCTOR_TYPES)[number] | (typeof RECEPTION_TYPES)[number] | (typeof SHARED_TYPES)[number];
export const ALL_PUSH_TYPES: readonly PushType[] = [
  ...DOCTOR_TYPES,
  ...RECEPTION_TYPES,
  ...SHARED_TYPES,
];

const TITLES: Record<PushType, string> = {
  new_booking: "حجز جديد · New booking",
  cancelled: "تم إلغاء موعد · Appointment cancelled",
  rescheduled: "تغيّر موعد · Appointment moved",
  checked_in: "وصل المريض · Patient arrived",
  request_answered: "رد على طلب التغيير · Request answered",
  online_booking: "حجز إلكتروني جديد · New online booking",
  patient_cancelled: "ألغى المريض من صفحته · Patient cancelled",
  patient_rescheduled: "غيّر المريض موعده · Patient moved",
  reschedule_request: "طلب تغيير من الطبيب · Doctor's request",
  patient_concern: "مريض لديه قلق بعد الإجراء · Patient concern",
};

const URLS: Record<PushType, string> = {
  new_booking: "/my-day",
  cancelled: "/my-day",
  rescheduled: "/my-day",
  checked_in: "/my-day",
  request_answered: "/my-day",
  online_booking: "/calendar",
  patient_cancelled: "/calendar",
  patient_rescheduled: "/calendar",
  reschedule_request: "/requests",
  patient_concern: "/whatsapp",
};

/** "العنود سليمان الرشيد" → "ع. ر." ; "Sara Ahmed" → "S. A." (first and last name only). */
export function initials(fullName: string): string {
  const words = fullName
    .trim()
    .split(/\s+/)
    .map((w) => w.replace(/^(ال|أل)(?=\S{2,})/, "")) // Arabic "al-" is not an initial
    .filter(Boolean);
  if (!words.length) return "—";
  const first = words[0];
  const last = words.length > 1 ? words[words.length - 1] : null;
  return [first, last]
    .filter((w): w is string => !!w)
    .map((w) => `${Array.from(w)[0].toUpperCase()}.`)
    .join(" ");
}

export interface PushPayload {
  title: string;
  body: string;
  url: string;
  /** Same tag replaces an older notification of the same type about the same appointment. */
  tag: string;
}

/** Riyadh "dd/MM HH:mm" (Western digits). */
function when(date: Date): string {
  const p = new Date(date.getTime() + 3 * 3600_000).toISOString();
  return `${p.slice(8, 10)}/${p.slice(5, 7)} ${p.slice(11, 16)}`;
}

export function buildPayload(input: {
  type: PushType;
  appointmentId: string;
  patientName: string;
  serviceName: string;
  startsAt: Date;
}): PushPayload {
  return {
    title: TITLES[input.type],
    body: `${initials(input.patientName)} · ${input.serviceName} · ${when(input.startsAt)}`,
    url: URLS[input.type],
    // One tag per type AND appointment: a "concern" must not silently replace an earlier
    // "patient arrived" for the same visit (iPhone replaces same-tag notifications without alert).
    tag: `${input.type}-${input.appointmentId}`,
  };
}
