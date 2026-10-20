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
  { href: "/", key: "dashboard", permission: "dashboard:view" },
  { href: "/patients", key: "patients", permission: "patients:read" },
  { href: "/services", key: "services", permission: "services:read" },
  { href: "/clinical-notes", key: "clinicalNotes", permission: "clinical_notes:read" },
  { href: "/platform", key: "platform", permission: "platform:read" },
] as const satisfies readonly { href: string; key: string; permission: Permission }[];
