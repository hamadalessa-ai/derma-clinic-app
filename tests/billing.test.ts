/**
 * Plans and billing (recorded by hand): plan features and default limits, statements with 15 %
 * VAT, payments, and the overdue rule (read-only until paid, lifted automatically). Only platform
 * work writes billing rows; clinic staff can read their own, never change them.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, getDb } from "@/db/client";
import { platformStatements, tenants } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import {
  BillingError,
  issueStatement,
  monthPeriod,
  recordStatementPayment,
  runBilling,
  setClinicPlan,
  statementsIn,
  statementsOf,
} from "@/lib/platform/billing";
import { createClinic } from "@/lib/platform/clinics";
import { effectiveLimits } from "@/lib/platform/limits";
import { planAllows, PLANS, vatOf } from "@/lib/platform/plans";
import { setClinicStatus } from "@/lib/platform/status";
import { admin, DERMA } from "./fixtures";

afterAll(closeDb);

const OWNER = { userId: "usr_platform-owner", roles: ["platform_owner"] as const };
const stamp = Date.now().toString(36);
const row = async (id: string) =>
  (await getDb().select().from(tenants).where(eq(tenants.id, id)))[0];
const code = async (p: Promise<unknown>) =>
  p.then(
    () => "ok",
    (e) =>
      e instanceof BillingError
        ? e.code
        : e instanceof PermissionError
          ? "not_allowed"
          : Promise.reject(e),
  );

async function newClinic(tag: string, isDemo = true) {
  return createClinic(OWNER, {
    slug: `bill-${tag}-${stamp}`,
    nameAr: "عيادة الفوترة",
    nameEn: "Billing Clinic",
    brandColor: "#28817a",
    isDemo,
    branch: { nameAr: "الفرع", nameEn: "Main", cityAr: "الرياض", cityEn: "Riyadh" },
    department: { nameAr: "الجلدية", nameEn: "Dermatology" },
    admin: { nameAr: "مدير", email: `admin-bill-${tag}-${stamp}@t.demo` },
  });
}

describe("plans", () => {
  it("decide features and default limits; a clinic's own limits win", () => {
    expect(planAllows({ plan: "basic" }, "aiScribe")).toBe(false);
    expect(planAllows({ plan: "pro" }, "video")).toBe(true);
    expect(effectiveLimits({ plan: "pro", limits: {} })).toEqual(PLANS.pro.limits);
    expect(effectiveLimits({ plan: "pro", limits: { aiMonthly: 10 } })).toEqual({
      aiMonthly: 10,
      whatsappMonthly: PLANS.pro.limits.whatsappMonthly,
    });
    expect(effectiveLimits({ plan: "enterprise", limits: {} })).toEqual({
      aiMonthly: null,
      whatsappMonthly: null,
    });
  });

  it("months and VAT", () => {
    expect(monthPeriod("2026-02-14")).toEqual({ start: "2026-02-01", end: "2026-02-28" });
    expect(monthPeriod("2026-12-31")).toEqual({ start: "2026-12-01", end: "2026-12-31" });
    expect(vatOf(100000)).toBe(15000);
  });
});

describe("statements and payments", () => {
  it("issue with VAT, once per month, only by the platform owner", async () => {
    const c = await newClinic("a");
    expect(await code(issueStatement(OWNER, c.tenantId))).toBe("free");
    await setClinicPlan(OWNER, c.tenantId, {
      plan: "basic",
      priceHalalas: 50000,
      trialEndsOn: null,
      graceDays: 7,
    });
    expect(await row(c.tenantId)).toMatchObject({ plan: "basic", monthlyPriceHalalas: 50000 });
    const st = await issueStatement(OWNER, c.tenantId, { periodDay: "2026-03-10" });
    expect(st).toMatchObject({ amountHalalas: 50000, vatHalalas: 7500, totalHalalas: 57500 });
    expect(st.number).toBe(`BILL-A-${stamp.toUpperCase()}-202603-1`);
    expect(await code(issueStatement(OWNER, c.tenantId, { periodDay: "2026-03-20" }))).toBe(
      "exists",
    );
    expect(
      await code(
        issueStatement({ userId: "usr_derma-admin", roles: ["clinic_admin"] }, c.tenantId),
      ),
    ).toBe("not_allowed");
  });

  it("partial then full payment; never more than what is due", async () => {
    const c = await newClinic("b");
    await setClinicPlan(OWNER, c.tenantId, {
      plan: "pro",
      priceHalalas: 100000,
      trialEndsOn: null,
      graceDays: 7,
    });
    const st = await issueStatement(OWNER, c.tenantId);
    const pay = (amountHalalas: number) =>
      recordStatementPayment(OWNER, c.tenantId, {
        statementId: st.id,
        amountHalalas,
        method: "transfer",
      });
    expect(await code(pay(200000))).toBe("too_much");
    expect((await pay(15000)).settled).toBe(false);
    expect((await pay(100000)).settled).toBe(true);
    const [view] = await statementsOf(c.tenantId);
    expect(view).toMatchObject({ status: "paid", paidHalalas: 115000 });
    expect(await code(pay(1))).toBe("not_open");
  });

  it("clinic staff read their own statements but cannot write billing rows", async () => {
    const own = await withActor(admin, (tx) => statementsIn(tx));
    expect(own.length).toBeGreaterThan(0);
    await expect(
      withActor(admin, (tx) =>
        tx.insert(platformStatements).values({
          tenantId: DERMA,
          number: `HACK-${stamp}`,
          periodStart: "2030-01-01",
          periodEnd: "2030-01-31",
          amountHalalas: 0,
          vatHalalas: 0,
          totalHalalas: 0,
          dueOn: "2030-01-10",
        }),
      ),
    ).rejects.toThrow();
    await expect(
      withActor(admin, (tx) =>
        tx
          .update(platformStatements)
          .set({ status: "paid" })
          .where(eq(platformStatements.tenantId, DERMA)),
      ),
    ).rejects.toThrow();
  });
});

describe("the overdue rule", () => {
  it("makes a live clinic read-only after due date + grace, and lifts it once paid", async () => {
    const c = await newClinic("c", false);
    await setClinicPlan(OWNER, c.tenantId, {
      plan: "pro",
      priceHalalas: 100000,
      trialEndsOn: null,
      graceDays: 0,
    });
    // The daily job issues this month's statement (due in 7 days): nothing overdue yet.
    const first = await runBilling();
    expect(first[`bill-c-${stamp}`]).toBe("issued, active");
    // An older statement, due long ago.
    const old = await issueStatement(OWNER, c.tenantId, {
      periodDay: "2026-01-15",
      dueOn: "2026-01-20",
    });
    await runBilling();
    expect(await row(c.tenantId)).toMatchObject({ status: "read_only", pausedForBilling: true });
    const r = await recordStatementPayment(OWNER, c.tenantId, {
      statementId: old.id,
      amountHalalas: old.totalHalalas,
      method: "transfer",
      reference: "TX-1",
    });
    expect(r).toEqual({ settled: true, status: "active" });
    expect(await row(c.tenantId)).toMatchObject({ status: "active", pausedForBilling: false });
  });

  it("never overrides a status the owner set by hand, and skips demo clinics", async () => {
    const c = await newClinic("d", false);
    await setClinicPlan(OWNER, c.tenantId, {
      plan: "pro",
      priceHalalas: 100000,
      trialEndsOn: null,
      graceDays: 0,
    });
    await issueStatement(OWNER, c.tenantId, { periodDay: "2026-01-15", dueOn: "2026-01-20" });
    await setClinicStatus(OWNER, c.tenantId, "suspended", "Owner decision");
    await runBilling();
    expect(await row(c.tenantId)).toMatchObject({ status: "suspended", pausedForBilling: false });
    const result = await runBilling();
    expect(Object.keys(result)).not.toContain("derma");
  });

  it("issues nothing during a free trial", async () => {
    const c = await newClinic("e", false);
    await setClinicPlan(OWNER, c.tenantId, {
      plan: "pro",
      priceHalalas: 100000,
      trialEndsOn: "2099-01-01",
      graceDays: 7,
    });
    await runBilling();
    expect(await statementsOf(c.tenantId)).toEqual([]);
  });
});
