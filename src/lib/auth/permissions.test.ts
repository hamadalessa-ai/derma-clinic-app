import { describe, expect, it } from "vitest";
import { can, NAV_ITEMS, PERMISSIONS, ROLES, type Permission, type Role } from "./permissions";

// The full truth table. If you change a permission, change this table on purpose.
const EXPECTED: Record<Permission, Record<Role, boolean>> = {
  "dashboard:view": {
    platform_owner: true,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
  },
  "patients:read": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
  },
  "services:read": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
  },
  "clinical_notes:read": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: false,
  },
  "platform:read": {
    platform_owner: true,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
  },
};

describe("role permissions", () => {
  for (const permission of Object.keys(PERMISSIONS) as Permission[]) {
    for (const role of ROLES) {
      it(`${role} ${EXPECTED[permission][role] ? "CAN" : "cannot"} ${permission}`, () => {
        expect(can(role, permission)).toBe(EXPECTED[permission][role]);
      });
    }
  }

  it("receptionists can never see clinical notes", () => {
    expect(can("receptionist", "clinical_notes:read")).toBe(false);
  });

  it("the platform owner has no access to patient data", () => {
    expect(can("platform_owner", "patients:read")).toBe(false);
    expect(can("platform_owner", "clinical_notes:read")).toBe(false);
  });

  it("no role means no access", () => {
    expect(can(null, "dashboard:view")).toBe(false);
    expect(can(undefined, "patients:read")).toBe(false);
  });

  it("every sidebar page is guarded by a known permission", () => {
    for (const item of NAV_ITEMS) expect(PERMISSIONS[item.permission]).toBeDefined();
  });
});
