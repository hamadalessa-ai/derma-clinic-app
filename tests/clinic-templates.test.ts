/**
 * Ready starts for new clinics: every service's consent form and every package's service exist in
 * the same template, and a new clinic gets them (sample prices, sample wording, rooms).
 */
import { afterAll, describe, expect, it } from "vitest";
import { closeDb } from "@/db/client";
import {
  consentRules,
  consentTemplates,
  departments,
  packageTemplates,
  rooms,
  services,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { createClinic } from "@/lib/platform/clinics";
import { clinicTemplate, SPECIALTIES } from "@/lib/platform/templates";

afterAll(closeDb);

const stamp = Date.now()
  .toString(36)
  .replace(/[^a-z]/g, "");

describe("templates", () => {
  it.each(SPECIALTIES)("%s is complete and consistent", (s) => {
    const t = clinicTemplate(s);
    const codes = t.departments.flatMap((d) => d.services.map((x) => x.code));
    expect(new Set(codes).size).toBe(codes.length);
    const consents = new Set(t.consents.map((c) => c.code));
    for (const d of t.departments)
      for (const x of d.services) if (x.consent) expect(consents.has(x.consent)).toBe(true);
    for (const p of t.packages) expect(codes).toContain(p.service);
    // Sample wording is labelled, never the demo notice.
    for (const c of t.consents) {
      expect(c.bodyEn).toMatch(/^Sample wording/);
      expect(c.bodyEn).not.toMatch(/demo wording/i);
    }
    expect(t.rooms.length).toBeGreaterThan(0);
  });
});

describe("a new clinic from a template", () => {
  it.each(["dermatology", "dental"] as const)("%s clinic is ready to set up", async (specialty) => {
    const c = await createClinic(
      { userId: "usr_platform-owner", roles: ["platform_owner"] },
      {
        slug: `tpl-${specialty.slice(0, 4)}-${stamp}`.slice(0, 30),
        nameAr: "عيادة",
        nameEn: "Clinic",
        brandColor: "#28817a",
        isDemo: true,
        specialty,
        branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
        department: { nameAr: "x", nameEn: "x" },
        admin: { nameAr: "مدير", email: `admin-tpl-${specialty}-${stamp}@t.demo` },
      },
    );
    const t = clinicTemplate(specialty);
    const got = await withTenant(c.tenantId, async (tx) => ({
      departments: await tx.select().from(departments),
      services: await tx.select().from(services),
      consents: await tx.select().from(consentTemplates),
      rules: await tx.select().from(consentRules),
      packages: await tx.select().from(packageTemplates),
      rooms: await tx.select().from(rooms),
    }));
    expect(got.departments.map((d) => d.code).sort()).toEqual(
      t.departments.map((d) => d.code).sort(),
    );
    expect(got.services).toHaveLength(t.departments.flatMap((d) => d.services).length);
    expect(got.services.every((s) => s.isDemoValue)).toBe(true);
    expect(got.consents).toHaveLength(t.consents.length);
    expect(got.rules).toHaveLength(t.consents.length);
    expect(got.packages).toHaveLength(t.packages.length);
    // The template's rooms plus the video room.
    expect(got.rooms.filter((r) => r.isVirtual)).toHaveLength(1);
    expect(got.rooms.filter((r) => !r.isVirtual)).toHaveLength(t.rooms.length);
  });
});
