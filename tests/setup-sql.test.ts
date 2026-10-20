import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSetupSql } from "@/db/setup-sql";
import { BRANCH_SCOPED_TABLES, PRACTITIONER_ONLY_TABLES, TENANT_TABLES } from "@/db/schema";
import { DERMA, DERMA_SERVICES, LAMSA } from "@/db/seed-data";
import ar from "../messages/ar.json";
import en from "../messages/en.json";

describe("db/setup.sql", () => {
  it("is up to date with the schema and seed (run `pnpm db:build-setup`)", () => {
    const onDisk = readFileSync(path.resolve(__dirname, "../db/setup.sql"), "utf8");
    expect(onDisk).toBe(buildSetupSql());
  });

  it("protects every tenant table listed in the schema", () => {
    const rls = readFileSync(path.resolve(__dirname, "../db/rls.sql"), "utf8");
    for (const table of TENANT_TABLES) expect(rls).toContain(`'${table}'`);
  });

  it("applies branch walls and the practitioner-only rule to the listed tables", () => {
    const rls = readFileSync(path.resolve(__dirname, "../db/rls.sql"), "utf8");
    const branchLoop = rls.slice(
      rls.indexOf("Branch-scoped tables"),
      rls.indexOf("Clinical notes: ONLY"),
    );
    for (const table of BRANCH_SCOPED_TABLES) expect(branchLoop).toContain(`'${table}'`);
    const notesLoop = rls.slice(
      rls.indexOf("Clinical notes: ONLY"),
      rls.indexOf("Notes and addenda are written"),
    );
    for (const table of PRACTITIONER_ONLY_TABLES) expect(notesLoop).toContain(`'${table}'`);
  });

  it("contains no real-looking secrets, only placeholders", () => {
    const sql = buildSetupSql();
    expect(sql).toContain("CHANGE_ME_APP_DB_PASSWORD");
    expect(sql).toContain("CHANGE_ME_DEMO_PASSWORD");
    expect(sql).not.toMatch(/\$2[aby]\$/); // no pre-computed password hashes
  });
});

describe("seed data matches the brief", () => {
  it("Derma Clinics has the requested structure", () => {
    expect(DERMA.slug).toBe("derma");
    expect(DERMA.brandColor).toBe("#28817a");
    expect(DERMA.branches.map((b) => b.key)).toEqual(["riyadh", "jeddah"]);
    expect(DERMA.departments.filter((d) => d.isActive).map((d) => d.code)).toEqual(["dermatology"]);
    expect(DERMA.departments).toHaveLength(4);
    const at = (branch: string, role: string) =>
      DERMA.staff.filter((s) => s.branch === branch && s.roles.includes(role as never)).length;
    expect(DERMA.staff.filter((s) => s.roles.includes("clinic_admin"))).toHaveLength(1);
    expect([at("riyadh", "practitioner"), at("riyadh", "receptionist")]).toEqual([3, 2]);
    expect([at("jeddah", "practitioner"), at("jeddah", "receptionist")]).toEqual([2, 1]);
    expect(DERMA.rooms.filter((r) => r.branch === "riyadh")).toHaveLength(4);
    expect(DERMA.rooms.filter((r) => r.branch === "jeddah")).toHaveLength(2);
    expect(DERMA.devices.filter((d) => d.branch === "riyadh")).toHaveLength(7);
    expect(DERMA.devices.filter((d) => d.branch === "jeddah")).toHaveLength(1);
    expect(DERMA_SERVICES).toHaveLength(22);
    expect(DERMA.patients).toHaveLength(40);
  });

  it("links laser and device services to the right device", () => {
    const device = Object.fromEntries(DERMA_SERVICES.map((s) => [s.code, s.requiredDeviceType]));
    expect(device).toMatchObject({
      scarlet_rf: "scarlet_rf",
      vascular_laser: "vascular_laser",
      laser_pigmentation: "pico_laser",
      laser_tattoo: "pico_laser",
      fractional_laser: "fractional_laser",
      morpheus8: "morpheus8",
      ultherapy: "ultherapy",
      laser_hair_removal: "hair_removal_laser",
    });
  });

  it("every device a service needs exists in at least one branch", () => {
    for (const clinic of [DERMA, LAMSA]) {
      const owned = new Set(clinic.devices.map((d) => d.deviceType));
      for (const s of clinic.services) {
        if (s.requiredDeviceType)
          expect(owned, `${clinic.slug}: ${s.code}`).toContain(s.requiredDeviceType);
      }
    }
  });

  it("every device type has an Arabic and English label", () => {
    for (const d of DERMA.devices) {
      expect(ar.deviceTypes).toHaveProperty(d.deviceType);
      expect(en.deviceTypes).toHaveProperty(d.deviceType);
    }
  });

  it("patients look fake and are unique", () => {
    for (const p of [...DERMA.patients, ...LAMSA.patients]) {
      expect(p.phone).toMatch(/^05000[12]\d{4}$/);
      expect(p.idNumber).toMatch(p.idType === "iqama" ? /^2\d{9}$/ : /^1\d{9}$/);
      expect(p.fullNameAr).toMatch(/[؀-ۿ]/);
    }
    const phones = new Set([...DERMA.patients, ...LAMSA.patients].map((p) => p.phone));
    expect(phones.size).toBe(48);
  });
});

describe("migration statement order", () => {
  it("creates unique constraints before foreign keys that reference them", async () => {
    const { orderMigrationStatements } = await import("@/db/setup-sql");
    const out = orderMigrationStatements(
      [
        `CREATE TABLE "a" ("id" uuid);`,
        `ALTER TABLE "b" ADD CONSTRAINT "b_fk" FOREIGN KEY ("x") REFERENCES "a"("id");`,
        `ALTER TABLE "a" ADD CONSTRAINT "a_key" UNIQUE("id");`,
      ].join("--> statement-breakpoint\n"),
    );
    expect(out.indexOf("a_key")).toBeLessThan(out.indexOf("b_fk"));
    expect(out.indexOf("CREATE TABLE")).toBe(0);
  });
});
