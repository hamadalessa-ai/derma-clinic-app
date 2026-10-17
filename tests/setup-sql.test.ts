import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildSetupSql } from "@/db/setup-sql";
import { TENANT_TABLES } from "@/db/schema";
import { DERMA, DERMA_SERVICES, LAMSA } from "@/db/seed-data";

describe("db/setup.sql", () => {
  it("is up to date with the schema and seed (run `pnpm db:build-setup`)", () => {
    const onDisk = readFileSync(path.resolve(__dirname, "../db/setup.sql"), "utf8");
    expect(onDisk).toBe(buildSetupSql());
  });

  it("protects every tenant table listed in the schema", () => {
    const rls = readFileSync(path.resolve(__dirname, "../db/rls.sql"), "utf8");
    for (const table of TENANT_TABLES) expect(rls).toContain(`'${table}'`);
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
    expect(DERMA.devices.filter((d) => d.branch === "riyadh")).toHaveLength(4);
    expect(DERMA.devices.filter((d) => d.branch === "jeddah")).toHaveLength(1);
    expect(DERMA_SERVICES).toHaveLength(22);
    expect(DERMA.patients).toHaveLength(40);
  });

  it("patients look fake and are unique", () => {
    for (const p of [...DERMA.patients, ...LAMSA.patients]) {
      expect(p.phone).toMatch(/^05000[12]\d{4}$/);
      expect(p.fullNameAr).toMatch(/[؀-ۿ]/);
    }
    const phones = new Set([...DERMA.patients, ...LAMSA.patients].map((p) => p.phone));
    expect(phones.size).toBe(48);
  });
});
