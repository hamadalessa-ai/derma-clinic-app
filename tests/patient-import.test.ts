/**
 * Patient import from a spreadsheet (CSV): rows are checked first, nothing is saved until the
 * admin imports, existing patients are skipped, and used package sessions become one correction.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import {
  auditLogs,
  packageSessionEvents,
  patientPackages,
  patients,
  tenantMembers,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { checkImport, mapHeader, parseCsv, runImport, TEMPLATE_CSV } from "@/lib/patients/import";
import { createClinic } from "@/lib/platform/clinics";
import { reception } from "./fixtures";

afterAll(closeDb);

const stamp = Date.now()
  .toString(36)
  .replace(/[^a-z]/g, "");

describe("reading the file", () => {
  it("handles quotes, line breaks inside quotes, semicolons and a BOM", () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\n\n"two\nlines",z')).toEqual([
      ["a", "b"],
      ["x, y", 'say "hi"'],
      ["two\nlines", "z"],
    ]);
    expect(parseCsv("a;b\n1;2")).toEqual([
      ["a", "b"],
      ["1", "2"],
    ]);
  });

  it("understands Arabic and English column titles", () => {
    expect(mapHeader(["الاسم", "رقم الجوال", "الجنس", "something else"])).toEqual({
      nameAr: 0,
      phone: 1,
      gender: 2,
    });
    expect(mapHeader(parseCsv(TEMPLATE_CSV)[0]!)).toMatchObject({
      nameAr: 1,
      phone: 3,
      package: 8,
    });
  });
});

describe("importing into a clinic", () => {
  let owner: Actor;

  beforeAll(async () => {
    const c = await createClinic(
      { userId: "usr_platform-owner", roles: ["platform_owner"] },
      {
        slug: `imp-${stamp}`.slice(0, 30),
        nameAr: "عيادة الاستيراد",
        nameEn: "Import Clinic",
        brandColor: "#28817a",
        isDemo: true,
        specialty: "dermatology",
        branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
        department: { nameAr: "x", nameEn: "x" },
        admin: { nameAr: "مدير", email: `admin-imp-${stamp}@t.demo` },
      },
    );
    const [m] = await withTenant(c.tenantId, (tx) =>
      tx.select({ id: tenantMembers.id }).from(tenantMembers),
    );
    owner = {
      tenantId: c.tenantId,
      userId: c.adminUserId,
      roles: ["clinic_admin"],
      memberId: m!.id,
      restrictedBranchId: null,
    };
  });

  const csv = [
    "الاسم,الجوال,الجنس,تاريخ الميلاد,الباقة,الجلسات المستخدمة",
    "سارة علي,0551110001,أنثى,14/05/1990,باقة ليزر إزالة الشعر — 6 جلسات,2",
    "خالد محمد,+966551110002,male,,,",
    ",0551110003,female,,,",
    "منى,12345,female,,,",
    "هند,0551110005,unknown,31/02/1990,,",
    "ريم,0551110006,female,,باقة غير موجودة,1",
    "سارة علي,0551110001,female,,,",
  ].join("\n");

  it("checks every row and says what is wrong, without saving anything", async () => {
    const r = await withActor(owner, (tx) => checkImport(tx, csv));
    expect(r.total).toBe(7);
    expect(r.ok.map((x) => x.nameAr)).toEqual(["سارة علي", "خالد محمد"]);
    expect(r.ok[0]).toMatchObject({
      phone: "0551110001",
      gender: "female",
      dateOfBirth: "1990-05-14",
    });
    expect(r.ok[0]!.package).toMatchObject({ used: 2 });
    const byLine = Object.fromEntries(r.problems.map((p) => [p.line, p.problems]));
    expect(byLine).toEqual({
      4: ["missing_name"],
      5: ["bad_phone"],
      6: ["bad_gender", "bad_date"],
      7: ["unknown_package"],
      8: ["duplicate_in_file"],
    });
    expect(await withActor(owner, (tx) => tx.select().from(patients))).toHaveLength(0);
  });

  it("says which needed columns are missing", async () => {
    const r = await withActor(owner, (tx) => checkImport(tx, "name,email\nسارة,a@b.co"));
    expect(r.missingColumns).toEqual(["phone", "gender"]);
  });

  it("imports the good rows with their package balance, then skips them next time", async () => {
    const r = await withActor(owner, (tx) =>
      runImport(tx, owner, csv, { filePrefix: "I", isDemo: true }),
    );
    expect(r).toMatchObject({ imported: 2, packages: 1, skipped: 5 });

    const got = await withActor(owner, async (tx) => ({
      patients: await tx.select().from(patients),
      packages: await tx.select().from(patientPackages),
      events: await tx.select().from(packageSessionEvents),
      log: await tx.select().from(auditLogs).where(eq(auditLogs.action, "patients.import")),
    }));
    expect(got.patients).toHaveLength(2);
    expect(got.patients.every((p) => p.isFake && p.fileNumber.startsWith("I"))).toBe(true);
    expect(got.packages).toHaveLength(1);
    expect(got.packages[0]).toMatchObject({ sessionsTotal: 6, sessionsUsed: 2 });
    expect(got.events).toEqual([expect.objectContaining({ kind: "override", delta: 2 })]);
    // The log keeps counts only — no names or mobiles.
    expect(got.log).toHaveLength(1);
    expect(JSON.stringify(got.log[0]!.metadata)).not.toMatch(/سارة|0551/);

    const again = await withActor(owner, (tx) => checkImport(tx, csv));
    expect(again.ok).toHaveLength(0);
    expect(again.problems.find((p) => p.line === 2)?.problems).toEqual(["already_exists"]);
  });

  it("is for clinic admins only", async () => {
    await expect(
      withActor(reception, (tx) =>
        runImport(tx, reception, csv, { filePrefix: "D", isDemo: true }),
      ),
    ).rejects.toThrow(PermissionError);
  });
});
