/**
 * Clinic account status: only the platform owner changes it (app AND database check), it is
 * audited in the clinic's own log, and it switches things off in one place (src/lib/tenant/status.ts).
 * Also: the clinic admin's CSV export.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { accounts, auditLogs, tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { canSignInToClinic, getStaffAccess } from "@/lib/auth/access";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { exportCsv, toCsv } from "@/lib/export/clinic-export";
import { createClinic } from "@/lib/platform/clinics";
import { setupOf } from "@/lib/platform/overview";
import { setClinicStatus } from "@/lib/platform/status";
import { clinicIsActive, publicPagesOpen, staffMaySignIn } from "@/lib/tenant/status";
import { whatsappMode } from "@/lib/whatsapp/config";
import { admin } from "./fixtures";

afterAll(closeDb);

const OWNER = { userId: "usr_platform-owner", roles: ["platform_owner"] as const };
const stamp = Date.now().toString(36);

async function newClinic(tag: string) {
  const slug = `st-${tag}-${stamp}`;
  const email = `admin-${slug}@t.demo`;
  const r = await createClinic(OWNER, {
    slug,
    nameAr: "عيادة الحالة",
    nameEn: "Status Clinic",
    brandColor: "#28817a",
    isDemo: true,
    branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
    department: { nameAr: "الجلدية", nameEn: "Dermatology" },
    admin: { nameAr: "مدير", email },
  });
  return { ...r, email };
}
const statusOf = async (id: string) =>
  (await getDb().select().from(tenants).where(eq(tenants.id, id)))[0];

describe("status rules", () => {
  it("say what each status allows", () => {
    expect(
      [clinicIsActive, staffMaySignIn, publicPagesOpen].map((f) => f({ status: "active" })),
    ).toEqual([true, true, true]);
    expect(
      [clinicIsActive, staffMaySignIn, publicPagesOpen].map((f) => f({ status: "read_only" })),
    ).toEqual([false, true, true]);
    expect(
      [clinicIsActive, staffMaySignIn, publicPagesOpen].map((f) => f({ status: "suspended" })),
    ).toEqual([false, false, false]);
    expect(
      [clinicIsActive, staffMaySignIn, publicPagesOpen].map((f) => f({ status: "closed" })),
    ).toEqual([false, true, false]);
  });

  it("switch WhatsApp off for a paused clinic", () => {
    const env = { MESSAGE_DEMO_MODE: "on" };
    expect(whatsappMode({ isDemo: true, slug: "x", status: "active" }, env)).toBe("demo");
    expect(whatsappMode({ isDemo: true, slug: "x", status: "read_only" }, env)).toBe("off");
  });
});

describe("changing a clinic's status", () => {
  it("pauses and resumes, records who and why, and gates sign-in", async () => {
    const c = await newClinic("a");
    expect((await statusOf(c.tenantId)).status).toBe("active");

    expect(await setClinicStatus(OWNER, c.tenantId, "suspended", "Payment overdue")).toEqual({
      from: "active",
      to: "suspended",
    });
    const row = await statusOf(c.tenantId);
    expect(row).toMatchObject({ status: "suspended", statusReason: "Payment overdue" });
    expect(await canSignInToClinic(c.tenantId, c.email)).toBe(false);
    expect(await getStaffAccess(c.tenantId, { id: c.adminUserId })).toBeNull();
    // The platform owner still gets in.
    expect(
      await getStaffAccess(c.tenantId, { id: OWNER.userId, isPlatformOwner: true }),
    ).not.toBeNull();

    await setClinicStatus(OWNER, c.tenantId, "read_only", "Card expired");
    expect(await canSignInToClinic(c.tenantId, c.email)).toBe(true);

    await setClinicStatus(OWNER, c.tenantId, "active", null);
    expect(await statusOf(c.tenantId)).toMatchObject({ status: "active", statusReason: null });

    const log = await withTenant(c.tenantId, (tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.action, "clinic.status")),
    );
    expect(log.map((l) => (l.metadata as { to: string }).to).sort()).toEqual(
      ["active", "read_only", "suspended"].sort(),
    );
    expect(log.every((l) => l.actorUserId === OWNER.userId)).toBe(true);
  });

  it("is refused for anyone but the platform owner, also by the database", async () => {
    const c = await newClinic("b");
    await expect(
      setClinicStatus(
        { userId: "usr_derma-admin", roles: ["clinic_admin"] },
        c.tenantId,
        "suspended",
        "x",
      ),
    ).rejects.toBeInstanceOf(PermissionError);
    const refused = await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', 'usr_derma-admin', true)`);
        await tx.execute(
          sql`select public.app_set_clinic_status(${c.tenantId}::uuid, 'suspended', 'x')`,
        );
      })
      .then(
        () => "changed",
        (e: Error & { cause?: Error }) => String(e.cause?.message ?? e.message),
      );
    expect(refused).toMatch(/platform owner/);
    expect((await statusOf(c.tenantId)).status).toBe("active");
    // The app itself still can't write the clinic directory.
    await expect(
      getDb().execute(sql`update tenants set status = 'suspended' where id = ${c.tenantId}`),
    ).rejects.toThrow();
  });
});

describe("setup checklist", () => {
  it("starts nearly empty for a new clinic and notices the admin's password", async () => {
    const c = await newClinic("c");
    const tenant = await statusOf(c.tenantId);
    const before = await setupOf(tenant);
    expect(before).toMatchObject({ admin: false, services: false, hours: false, booking: false });
    await getDb()
      .insert(accounts)
      .values({
        id: `acc_${stamp}`,
        accountId: c.adminUserId,
        providerId: "credential",
        userId: c.adminUserId,
        password: "x",
      });
    expect((await setupOf(tenant)).admin).toBe(true);
  });
});

describe("clinic data export", () => {
  it("writes Excel-safe CSV", () => {
    const csv = toCsv(
      ["a", "b"],
      [
        ["x,y", '=HYPERLINK("evil")'],
        [null, 3],
      ],
    );
    expect(csv.startsWith("﻿")).toBe(true);
    expect(csv).toContain('"x,y"');
    expect(csv).toContain(`"'=HYPERLINK(""evil"")"`);
  });

  it("exports the admin's own clinic", async () => {
    const csv = await withActor(admin, (tx) => exportCsv(tx, "patients"));
    expect(csv.split("\r\n")[0]).toContain("file_number");
    expect(csv.split("\r\n").length).toBeGreaterThan(3);
  });
});
