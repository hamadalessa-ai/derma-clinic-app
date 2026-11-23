import { describe, expect, it } from "vitest";
import {
  can,
  NAV_ITEMS,
  PERMISSIONS,
  ROLES,
  splitForMobile,
  type Permission,
  type Role,
} from "./permissions";

// The full truth table. If you change a permission, change this table on purpose.
const EXPECTED: Record<Permission, Record<Role, boolean>> = {
  "dashboard:view": {
    platform_owner: true,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "patients:read": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "services:read": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "clinical_notes:read": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "platform:read": {
    platform_owner: true,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "calendar:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "appointments:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "appointments:own": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: false,
  },
  "my_day:view": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "visits:assist": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
    assistant: true,
  },
  "dental:chart": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "labs:view": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "labs:manage": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "dental:plan": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "lab:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "lab:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "help:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "visits:checkout": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "requests:decide": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "patients:edit": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "packages:sell": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "memberships:sell": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "packages:override": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "consents:collect": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "consents:templates": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "notes:write": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "settings:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "team:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "demo:refresh": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "account:manage": {
    platform_owner: true,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: true,
  },
  "whatsapp:inbox": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "whatsapp:simulator": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: true,
    assistant: false,
  },
  "concerns:handle": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: false,
  },
  "photos:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "photos:manage": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: true,
  },
  "whatsapp:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "hours:edit": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: true,
    receptionist: true,
    assistant: false,
  },
  "video:join": {
    platform_owner: false,
    clinic_admin: false,
    practitioner: true,
    receptionist: false,
    assistant: false,
  },
  "platform:keys": {
    platform_owner: true,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "data:export": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "billing:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "support:grant": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "setup:manage": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "patients:import": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "reports:view": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "invoicing:export": {
    platform_owner: false,
    clinic_admin: true,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "platform:billing": {
    platform_owner: true,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
    assistant: false,
  },
  "platform:clinics": {
    platform_owner: true,
    clinic_admin: false,
    practitioner: false,
    receptionist: false,
    assistant: false,
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

  it("doctors cannot book for others or approve requests; reception cannot write notes", () => {
    expect(can("practitioner", "appointments:manage")).toBe(false);
    expect(can("practitioner", "requests:decide")).toBe(false);
    expect(can("receptionist", "notes:write")).toBe(false);
    expect(can(["clinic_admin", "practitioner"], "notes:write")).toBe(true);
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

describe("phone navigation", () => {
  const itemsFor = (roles: Role[]) => NAV_ITEMS.filter((i) => can(roles, i.permission));

  it.each([
    [["practitioner"], ["myDay", "calendar", "patients", "clinicalNotes"]],
    [["receptionist"], ["calendar", "patients", "whatsapp", "services"]],
    [["clinic_admin"], ["calendar", "patients", "whatsapp", "settings"]],
    [["platform_owner"], ["platform", "account"]],
    [["assistant"], ["myDay", "calendar", "patients", "clinicalNotes"]],
  ] as [Role[], string[]][])("%s: the bottom bar shows the most-used pages", (roles, expected) => {
    expect(splitForMobile(itemsFor(roles)).bar.map((i) => i.key)).toEqual(expected);
  });

  it("never drops a page: bar + More = exactly the desktop items, for every role combination", () => {
    const combos: Role[][] = [
      ["practitioner"],
      ["receptionist"],
      ["clinic_admin"],
      ["platform_owner"],
      ["clinic_admin", "practitioner"],
    ];
    for (const roles of combos) {
      const items = itemsFor(roles);
      const { bar, more } = splitForMobile(items);
      expect([...bar, ...more].map((i) => i.href).sort()).toEqual(items.map((i) => i.href).sort());
      expect(bar.length).toBeLessThanOrEqual(5);
    }
  });
});
