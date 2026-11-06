/**
 * Usage and monthly limits: counted from what the app records (no message or note text), set only
 * by the platform owner, and enforced where the cost happens (AI receptionist, AI scribe, WhatsApp).
 * Essential messages (codes, replies to taps) and staff replies are never blocked by a limit.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { PermissionError } from "@/lib/auth/permissions";
import { createClinic } from "@/lib/platform/clinics";
import { effectiveLimits, monthStart, whatsappSentThisMonth } from "@/lib/platform/limits";
import { limitWarnings, usageOf } from "@/lib/platform/overview";
import { setClinicLimits } from "@/lib/platform/status";
import { prepareMessage } from "@/lib/whatsapp/send";
import { DERMA } from "./fixtures";

afterAll(closeDb);

const OWNER = { userId: "usr_platform-owner", roles: ["platform_owner"] as const };
const stamp = Date.now().toString(36);
const DEMO_ENV = { MESSAGE_DEMO_MODE: "on" };
const row = async (id: string) => (await getDb().select().from(tenants).where(eq(tenants.id, id)))[0];

async function newClinic(tag: string) {
  return createClinic(OWNER, {
    slug: `lim-${tag}-${stamp}`,
    nameAr: "عيادة الحدود",
    nameEn: "Limits Clinic",
    brandColor: "#28817a",
    isDemo: true,
    branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
    department: { nameAr: "الجلدية", nameEn: "Dermatology" },
    admin: { nameAr: "مدير", email: `admin-lim-${tag}-${stamp}@t.demo` },
  });
}

describe("limits", () => {
  it("are read safely (missing, negative or odd values = no limit)", () => {
    expect(effectiveLimits({})).toEqual({ aiMonthly: null, whatsappMonthly: null });
    expect(effectiveLimits({ limits: { aiMonthly: 100.7, whatsappMonthly: -1 } })).toEqual({
      aiMonthly: 100,
      whatsappMonthly: null,
    });
  });

  it("count from the first of the Riyadh month", () => {
    // 1 Nov 00:30 Riyadh = 31 Oct 21:30 UTC → still November in Riyadh.
    expect(monthStart(new Date("2026-10-31T21:30:00Z")).toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(monthStart(new Date("2026-11-20T10:00:00Z")).toISOString()).toBe("2026-10-31T21:00:00.000Z");
  });

  it("are set by the platform owner only (app AND database)", async () => {
    const c = await newClinic("a");
    await setClinicLimits(OWNER, c.tenantId, { aiMonthly: 500, whatsappMonthly: null });
    expect((await row(c.tenantId)).limits).toEqual({ aiMonthly: 500 });
    await expect(
      setClinicLimits({ userId: "usr_derma-admin", roles: ["clinic_admin"] }, c.tenantId, {
        aiMonthly: null,
        whatsappMonthly: null,
      }),
    ).rejects.toBeInstanceOf(PermissionError);
    const refused = await getDb()
      .transaction(async (tx) => {
        await tx.execute(sql`select set_config('app.user_id', 'usr_derma-admin', true)`);
        await tx.execute(sql`select public.app_set_clinic_limits(${c.tenantId}::uuid, null, null)`);
      })
      .then(
        () => "changed",
        (e: Error & { cause?: Error }) => String(e.cause?.message ?? e.message),
      );
    expect(refused).toMatch(/platform owner/);
    expect((await row(c.tenantId)).limits).toEqual({ aiMonthly: 500 });
  });
});

describe("the WhatsApp limit", () => {
  it("pauses reminders at the limit, never codes or staff replies", async () => {
    const c = await newClinic("b");
    await setClinicLimits(OWNER, c.tenantId, { aiMonthly: null, whatsappMonthly: 0 });
    const tenant = await row(c.tenantId);
    const out = await withTenant(c.tenantId, async (tx) => ({
      reminder: await prepareMessage(tx, tenant, { kind: "reminder", phone: "0551234567" }, DEMO_ENV),
      code: await prepareMessage(
        tx,
        tenant,
        { kind: "verification_code", phone: "0551234567", secrets: { code: "123456" } },
        DEMO_ENV,
      ),
      staff: await prepareMessage(
        tx,
        tenant,
        { kind: "staff_reply", phone: "0551234567", text: "Hello" },
        DEMO_ENV,
      ),
    }));
    expect(out.reminder).toEqual({ outcome: "skipped", reason: "monthly_limit" });
    expect(out.code.outcome).not.toBe("skipped");
    expect(out.staff).not.toEqual({ outcome: "skipped", reason: "monthly_limit" });
  });
});

describe("usage", () => {
  it("is counts only, per clinic", async () => {
    const tenant = await row(DERMA);
    const u = await usageOf(tenant);
    expect(u.staff).toBeGreaterThan(3);
    expect(u.branches).toBe(2);
    expect(typeof u.whatsappThisMonth).toBe("number");
    expect(await withTenant(DERMA, (tx) => whatsappSentThisMonth(tx))).toBe(u.whatsappThisMonth);
  });

  it("warns the clinic admin from 80 % of a limit", async () => {
    const c = await newClinic("c");
    expect(await limitWarnings(await row(c.tenantId))).toEqual([]);
    await setClinicLimits(OWNER, c.tenantId, { aiMonthly: 0, whatsappMonthly: null });
    expect(await limitWarnings(await row(c.tenantId))).toEqual([{ kind: "ai", used: 0, limit: 0 }]);
  });
});
