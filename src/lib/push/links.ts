/**
 * Where a tapped notification opens. Chosen PER RECIPIENT from their roles, so the link never
 * leads to a "no permission" page:
 *  - a patient concern: doctors → the patient's file with the concern and the post-care chat
 *    (read-only); reception → the WhatsApp inbox thread;
 *  - doctor events → My Day on that date (or the calendar for staff without My Day);
 *  - reception events → the calendar on that date; doctors' requests → Requests.
 * Every link falls back to the dashboard ("/"), which every clinic role may open.
 */
import { can, type Permission, type Role } from "@/lib/auth/permissions";
import { DOCTOR_TYPES, type PushType } from "./payload";

export interface LinkContext {
  appointmentId: string;
  patientId: string;
  /** Riyadh date of the appointment, YYYY-MM-DD. */
  day: string;
  /** The patient's WhatsApp chat, if there is one. */
  conversationId: string | null;
}

/**
 * The permission each page a notification can open asks for (its `requirePermission(...)`).
 * tests/push-links.test.ts checks this table against the page files themselves.
 */
export const PAGE_PERMISSIONS = {
  "/": "dashboard:view",
  "/my-day": "my_day:view",
  "/calendar": "calendar:view",
  "/requests": "requests:decide",
  "/whatsapp": "whatsapp:inbox",
  "/patients/[id]": "patients:read",
  "/account": "account:manage",
} as const satisfies Record<string, Permission>;

/** The page a link points to (query string removed, ids replaced by [id]). */
export function pageOf(url: string): keyof typeof PAGE_PERMISSIONS | null {
  const path = url.split(/[?#]/)[0].replace(/^\/patients\/[^/]+$/, "/patients/[id]");
  return path in PAGE_PERMISSIONS ? (path as keyof typeof PAGE_PERMISSIONS) : null;
}

/** True when someone with these roles may open this link. */
export function canOpen(roles: readonly Role[], url: string): boolean {
  const page = pageOf(url);
  return !!page && can(roles, PAGE_PERMISSIONS[page]);
}

export function concernLink(c: Pick<LinkContext, "patientId" | "appointmentId">) {
  return `/patients/${c.patientId}?concern=${c.appointmentId}#concern`;
}

export function pushLink(type: PushType, roles: readonly Role[], c: LinkContext): string {
  const myDay = `/my-day?date=${c.day}`;
  const calendar = `/calendar?date=${c.day}`;
  const inbox = c.conversationId
    ? `/whatsapp?f=needs_reply&c=${c.conversationId}`
    : "/whatsapp?f=needs_reply";
  const patient = concernLink(c);
  const concernish = ["patient_concern", "concern_note", "concern_photo"].includes(type);
  const choices: string[] = concernish
    ? // The appointment's doctor works on it in the patient's file; reception in the inbox.
      roles.includes("practitioner")
      ? [patient]
      : [inbox, patient]
    : type === "reschedule_request" || type === "follow_up_request"
      ? ["/requests", myDay, calendar]
      : (DOCTOR_TYPES as readonly string[]).includes(type)
        ? [myDay, calendar]
        : [calendar];
  return choices.find((url) => canOpen(roles, url)) ?? "/";
}
