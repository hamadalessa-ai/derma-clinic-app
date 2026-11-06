/**
 * What a clinic's account status allows. ONE place, used by sign-in, staff actions, public pages,
 * WhatsApp and the AI. The status is set only by the platform owner (src/lib/platform/status.ts).
 *
 *                      staff sign-in   staff changes   website, /book, /my   online booking, WhatsApp, AI
 *   active             yes             yes             yes                   yes
 *   read_only          yes             no              yes (view)            no
 *   suspended          no              no              closed                no
 *   closed             yes (to export) no              closed                no
 */
export const CLINIC_STATUSES = ["active", "read_only", "suspended", "closed"] as const;
export type ClinicStatus = (typeof CLINIC_STATUSES)[number];

type WithStatus = { status?: ClinicStatus | null };
const statusOf = (t: WithStatus) => t.status ?? "active";

/** Everything works: bookings, changes, WhatsApp, AI. */
export const clinicIsActive = (t: WithStatus) => statusOf(t) === "active";
/** Staff (not the platform owner) may sign in and look around. */
export const staffMaySignIn = (t: WithStatus) => statusOf(t) !== "suspended";
/** The website, patient page and links patients received are open. */
export const publicPagesOpen = (t: WithStatus) => ["active", "read_only"].includes(statusOf(t));
