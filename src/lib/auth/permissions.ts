/**
 * Who may do what. One place to read and change it.
 * Pages call requirePermission() (src/lib/auth/session.ts) with one of these permissions.
 */
export const ROLES = ["platform_owner", "clinic_admin", "practitioner", "receptionist"] as const;
export type Role = (typeof ROLES)[number];

const ALL_CLINIC_STAFF: Role[] = ["clinic_admin", "practitioner", "receptionist"];

export const PERMISSIONS = {
  "dashboard:view": ["platform_owner", ...ALL_CLINIC_STAFF],
  "patients:read": ALL_CLINIC_STAFF,
  "services:read": ALL_CLINIC_STAFF,
  // Clinical notes: practitioners only. Not admins (unless they are also a practitioner),
  // never receptionists, never the platform owner.
  "clinical_notes:read": ["practitioner"],
  "platform:read": ["platform_owner"],

  // ── Phase 1 ──
  "calendar:view": ALL_CLINIC_STAFF,
  /** Book, move, cancel, check in, record no-show — reception work. */
  "appointments:manage": ["clinic_admin", "receptionist"],
  /** Doctors: confirm/start/complete their OWN appointments, block their own time, reschedule own. */
  "appointments:own": ["practitioner"],
  "my_day:view": ["practitioner"],
  "requests:decide": ["clinic_admin", "receptionist"],
  "patients:edit": ["clinic_admin", "receptionist"],
  "packages:sell": ["clinic_admin", "receptionist"],
  "packages:override": ["clinic_admin", "receptionist"],
  "consents:collect": ["clinic_admin", "receptionist", "practitioner"],
  "consents:templates": ["clinic_admin"],
  "notes:write": ["practitioner"],
  "settings:manage": ["clinic_admin"],
  "demo:refresh": ["clinic_admin"],

  // ── Phase 2a ──
  /** Own account: phone notifications on/off and which types. */
  "account:manage": ALL_CLINIC_STAFF,
  /** Create the push (VAPID) keys for the platform. Never patient data. */
  "platform:keys": ["platform_owner"],

  // ── Phase 2b: WhatsApp ──
  /** Inbox: read chats, reply, link new contacts, "doctor running late", record WhatsApp consent. */
  "whatsapp:inbox": ["clinic_admin", "receptionist"],
  /** Demo simulator (demo clinics with MESSAGE_DEMO_MODE=on only). */
  "whatsapp:simulator": ["clinic_admin", "receptionist"],
  /** "Run scheduled messages now" (demo), message wording, WhatsApp status page. */
  "whatsapp:manage": ["clinic_admin"],
  /**
   * Post-care concerns: reply to the patient (24-hour window), ask for a photo, internal note,
   * follow-up, resolve. Doctors from the Concern card; reception/admin also from the inbox.
   */
  "concerns:handle": ["clinic_admin", "practitioner", "receptionist"],
  /** Photos patients send (medical): doctors and admins. Reception sees "photo received". */
  "photos:view": ["clinic_admin", "practitioner"],

  // ── Video consultations ──
  /** Join a video consultation (the appointment's own doctor only — checked in lib/video). */
  "video:join": ["practitioner"],

  // ── Working hours ──
  /** Weekly hours and one-off changes: admins (all), reception (own branch), doctors (own, if allowed). */
  "hours:edit": ALL_CLINIC_STAFF,
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

/**
 * A person can hold several roles in one clinic (e.g. admin AND practitioner).
 * They may do something if ANY of their roles allows it.
 */
export function can(
  roles: Role | readonly Role[] | null | undefined,
  permission: Permission,
): boolean {
  if (!roles) return false;
  const list: readonly Role[] = typeof roles === "string" ? [roles] : roles;
  const allowed = PERMISSIONS[permission] as readonly Role[];
  return list.some((r) => allowed.includes(r));
}

export class PermissionError extends Error {
  constructor(public permission: Permission) {
    super(`not allowed: ${permission}`);
    this.name = "PermissionError";
  }
}

/** Throws unless one of `roles` grants `permission`. Used inside business logic, not only screens. */
export function assertCan(roles: readonly Role[] | null | undefined, permission: Permission) {
  if (!can(roles, permission)) throw new PermissionError(permission);
}

/** Sidebar pages and the permission each one needs. */
export const NAV_ITEMS = [
  { href: "/my-day", key: "myDay", permission: "my_day:view" },
  { href: "/calendar", key: "calendar", permission: "calendar:view" },
  { href: "/patients", key: "patients", permission: "patients:read" },
  { href: "/clinical-notes", key: "clinicalNotes", permission: "clinical_notes:read" },
  { href: "/services", key: "services", permission: "services:read" },
  { href: "/settings", key: "settings", permission: "settings:manage" },
  { href: "/whatsapp", key: "whatsapp", permission: "whatsapp:inbox" },
  {
    href: "/whatsapp/simulator",
    key: "simulator",
    permission: "whatsapp:simulator",
    demoOnly: true,
  },
  { href: "/account", key: "account", permission: "account:manage" },
  { href: "/platform", key: "platform", permission: "platform:read" },
] as const satisfies readonly {
  href: string;
  key: string;
  permission: Permission;
  /** Only shown when the clinic is in WhatsApp demo mode. */
  demoOnly?: boolean;
}[];

/** Pages that matter most on a phone, in order. The first ones a role may see go in the bottom bar. */
export const MOBILE_PRIORITY = [
  "myDay",
  "calendar",
  "patients",
  "whatsapp",
  "clinicalNotes",
  "platform",
  "settings",
  "services",
  "whatsapp",
  "simulator",
  "account",
] as const;

/**
 * Splits the SAME allowed navigation items as the desktop sidebar into the phone's bottom bar
 * (at most `max`) and the "More" menu. Nothing is dropped: every item ends up in one of the two.
 */
export function splitForMobile<T extends { key: string }>(items: readonly T[], max = 4) {
  const rank = (k: string) => {
    const i = (MOBILE_PRIORITY as readonly string[]).indexOf(k);
    return i === -1 ? MOBILE_PRIORITY.length : i;
  };
  const sorted = [...items].sort((a, b) => rank(a.key) - rank(b.key));
  // With max+1 items or fewer, show them all in the bar (no "More" needed).
  if (sorted.length <= max + 1) return { bar: sorted, more: [] as T[] };
  return { bar: sorted.slice(0, max), more: sorted.slice(max) };
}
