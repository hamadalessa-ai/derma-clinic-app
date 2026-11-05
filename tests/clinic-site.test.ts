/**
 * The clinic's public website ("/"): built only from public clinic data (services, doctors'
 * names and titles, branches, free times, Settings → Website texts), never from patients;
 * each clinic sees only its own; only admins change the texts, and every change is audited.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, desc, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { loadClinicSite } from "@/lib/site/data";
import { saveSiteContent } from "@/lib/settings";
import { admin, DERMA, LAMSA, reception, service } from "./fixtures";

afterAll(closeDb);

describe("clinic website", () => {
  it("shows the clinic's own services, doctors, branches and texts", async () => {
    const site = await loadClinicSite(DERMA, new Date("2030-01-12T06:00:00Z"));
    const ids = site.catalog.departments.flatMap((d) => d.services.map((s) => s.id));
    expect(ids).toContain(service("consultation"));
    expect(site.videoService?.id).toBe(service("video_consultation"));
    expect(site.doctors.length).toBeGreaterThan(0);
    // Doctor profiles for the website (specialty, credentials, languages).
    const sara = site.doctors.find((d) => d.nameEn === "Dr. Sarah Al-Otaibi");
    expect(sara?.profile?.credentials?.length).toBeGreaterThan(0);
    expect(site.branches.map((b) => b.cityEn)).toEqual(expect.arrayContaining(["Riyadh"]));
    expect(site.site.since).toBe(1996);
    expect(site.site.specialties?.map((x) => x.key)).toEqual(["skin", "hair", "plastic", "dental"]);
    // Specialties not booked online appear as "ask us".
    expect(site.others.length).toBeGreaterThan(0);
    // Only public fields leave the loader: no patient data of any kind.
    expect(JSON.stringify(site)).not.toMatch(/D-\d{4}|@/);
  });

  it("offers real free times for a first visit", async () => {
    const site = await loadClinicSite(DERMA, new Date("2030-01-12T06:00:00Z"));
    expect(site.firstService?.id).toBe(service("consultation"));
    expect(site.nextFree.length).toBeGreaterThan(0);
    for (const iso of site.nextFree)
      expect(new Date(iso).getTime()).toBeGreaterThan(Date.parse("2030-01-12T06:00:00Z"));
  });

  it("each clinic sees only its own website", async () => {
    const lamsa = await loadClinicSite(LAMSA);
    const ids = lamsa.catalog.departments.flatMap((d) => d.services.map((s) => s.id));
    expect(ids).not.toContain(service("consultation"));
    expect(lamsa.site.since).toBeUndefined();
  });

  it("only admins change the texts; the change is audited", async () => {
    const before = await withTenant(
      DERMA,
      async (tx) => (await tx.select().from(tenantSettings))[0].site,
    );
    await expect(
      withActor(reception, (tx) => saveSiteContent(tx, reception, { headlineEn: "x" })),
    ).rejects.toThrow();
    const next = {
      ...before,
      phone: "+966 11 000 0000",
      reviews: [{ quote: "Great care", name: "N. A." }],
    };
    await withActor(admin, (tx) => saveSiteContent(tx, admin, next));
    const site = await loadClinicSite(DERMA);
    expect(site.site.phone).toBe("+966 11 000 0000");
    expect(site.site.reviews).toHaveLength(1);
    const [log] = await withTenant(DERMA, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "settings.site"), eq(auditLogs.entityId, DERMA)))
        .orderBy(desc(auditLogs.createdAt))
        .limit(1),
    );
    expect(log).toBeTruthy();
    await withActor(admin, (tx) => saveSiteContent(tx, admin, before));
  });
});
