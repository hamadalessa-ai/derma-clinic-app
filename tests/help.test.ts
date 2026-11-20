/** Help centre guides: every step in both languages, and every "Open" link goes to a real screen. */
import { existsSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { HELP_GUIDES, HELP_ROLES, helpRoleFor } from "@/lib/help/guides";

describe("help guides", () => {
  it("cover every role, in Arabic and English", () => {
    for (const role of HELP_ROLES) {
      expect(HELP_GUIDES[role].length, role).toBeGreaterThan(0);
      for (const g of HELP_GUIDES[role]) {
        expect(g.titleAr.trim() && g.titleEn.trim(), g.id).toBeTruthy();
        expect(g.steps.length, g.id).toBeGreaterThan(0);
        for (const s of g.steps) {
          expect(s.ar.trim(), g.id).toMatch(/[؀-ۿ]/);
          expect(s.en.trim(), g.id).toMatch(/[A-Za-z]/);
        }
      }
    }
  });

  it("links point at existing screens and real permissions", () => {
    for (const role of HELP_ROLES)
      for (const g of HELP_GUIDES[role]) {
        if (!g.link) continue;
        const path = g.link.href.split("?")[0]!;
        expect(existsSync(`src/app/(app)${path}/page.tsx`), g.link.href).toBe(true);
        expect(Object.keys(PERMISSIONS)).toContain(g.link.permission);
      }
  });

  it("open on the reader's own role", () => {
    expect(helpRoleFor(["assistant"])).toBe("assistant");
    expect(helpRoleFor(["practitioner", "clinic_admin"])).toBe("practitioner");
    expect(helpRoleFor(["clinic_admin"])).toBe("clinic_admin");
  });
});
