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
  // Clinical notes: never receptionists, never the platform owner.
  "clinical_notes:read": ["clinic_admin", "practitioner"],
  "platform:read": ["platform_owner"],
} as const satisfies Record<string, readonly Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  if (!role) return false;
  return (PERMISSIONS[permission] as readonly Role[]).includes(role);
}

/** Sidebar pages and the permission each one needs. */
export const NAV_ITEMS = [
  { href: "/", key: "dashboard", permission: "dashboard:view" },
  { href: "/patients", key: "patients", permission: "patients:read" },
  { href: "/services", key: "services", permission: "services:read" },
  { href: "/clinical-notes", key: "clinicalNotes", permission: "clinical_notes:read" },
  { href: "/platform", key: "platform", permission: "platform:read" },
] as const satisfies readonly { href: string; key: string; permission: Permission }[];
