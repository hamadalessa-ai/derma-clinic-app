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
    clinic_admin: false,
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

  it("clinic admins cannot see clinical notes on their own", () => {
    expect(can("clinic_admin", "clinical_notes:read")).toBe(false);
    expect(can(["clinic_admin"], "clinical_notes:read")).toBe(false);
  });

  it("someone who is both admin and practitioner gets both sets of permissions", () => {
    const both = ["clinic_admin", "practitioner"] as const;
    expect(can(both, "clinical_notes:read")).toBe(true);
    expect(can(both, "patients:read")).toBe(true);
    expect(can(both, "platform:read")).toBe(false);
  });

  it("admin + receptionist still cannot see clinical notes", () => {
    expect(can(["clinic_admin", "receptionist"], "clinical_notes:read")).toBe(false);
  });

  it("no role means no access", () => {
    expect(can(null, "dashboard:view")).toBe(false);
    expect(can(undefined, "patients:read")).toBe(false);
    expect(can([], "dashboard:view")).toBe(false);
  });

  it("every sidebar page is guarded by a known permission", () => {
    for (const item of NAV_ITEMS) expect(PERMISSIONS[item.permission]).toBeDefined();
  });
});
