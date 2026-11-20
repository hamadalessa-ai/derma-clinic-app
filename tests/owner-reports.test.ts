/**
 * Owner reports and the daily invoicing file: numbers add up, branches filter, money follows list
 * prices (0 when a package paid), and only clinic admins get them.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, desc, eq, gte, lt } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, packageSessionEvents } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { dayRange, riyadhDay } from "@/lib/booking/time";
import { DAILY_COLUMNS, dailyInvoicingCsv } from "@/lib/reports/daily-export";
import { isMonth, monthDays, ownerReport, shiftMonth } from "@/lib/reports/owner";
import { parseCsv } from "@/lib/patients/import";
import { demoId } from "@/db/seed-data";
import { admin, reception, RIYADH } from "./fixtures";

afterAll(closeDb);

describe("months", () => {
  it("knows the days of a month and moves between months", () => {
    expect(monthDays("2026-02").days).toHaveLength(28);
    expect(monthDays("2028-02").days).toHaveLength(29);
    expect(monthDays("2026-11").from.toISOString()).toBe("2026-10-31T21:00:00.000Z");
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(isMonth("2026-13")).toBe(false);
    expect(isMonth("2026-09")).toBe(true);
  });
});

async function busyDay() {
  const [a] = await withActor(admin, (tx) =>
    tx
      .select({ startsAt: appointments.startsAt })
      .from(appointments)
      .where(eq(appointments.status, "completed"))
      .orderBy(desc(appointments.startsAt))
      .limit(1),
  );
  expect(a).toBeDefined();
  return riyadhDay(a!.startsAt);
}

describe("owner report", () => {
  it("adds up", async () => {
    const month = (await busyDay()).slice(0, 7);
    const r = await withActor(admin, (tx) => ownerReport(tx, admin, month, null));
    const t = r.totals;
    expect(t.completed).toBeGreaterThan(0);
    expect(r.byDay.reduce((s, d) => s + d.bookings, 0)).toBe(t.bookings);
    expect(t.bySource.reception + t.bySource.online + t.bySource.whatsapp).toBe(t.bookings);
    expect(r.byDoctor.reduce((s, d) => s + d.bookings, 0)).toBe(t.bookings);
    expect(r.byDoctor.reduce((s, d) => s + d.value, 0)).toBe(t.visitValue);
    expect(r.byService.reduce((s, x) => s + x.completed, 0)).toBe(t.completed);
    expect(r.byBranch.reduce((s, b) => s + b.bookings, 0)).toBe(t.bookings);
    expect(t.noShowRate).toBeGreaterThanOrEqual(0);
    expect(t.noShowRate).toBeLessThanOrEqual(100);
  });

  it("filters by branch; packages and new patients stay clinic-wide", async () => {
    const month = (await busyDay()).slice(0, 7);
    const [all, one] = await withActor(admin, async (tx) => [
      await ownerReport(tx, admin, month, null),
      await ownerReport(tx, admin, month, RIYADH),
    ]);
    expect(one.totals.bookings).toBeLessThanOrEqual(all.totals.bookings);
    expect(one.totals.bookings).toBe(all.byBranch.find((b) => b.id === RIYADH)?.bookings ?? 0);
    expect(one.totals.packagesSold).toBe(0);
    expect(one.totals.newPatients).toBe(0);
  });

  it("is for clinic admins only", async () => {
    await expect(
      withActor(reception, (tx) => ownerReport(tx, reception, "2026-01", null)),
    ).rejects.toThrow(PermissionError);
  });
});

describe("daily invoicing file", () => {
  it("lists the day's completed visits; a package visit is 0", async () => {
    const day = await busyDay();
    const [from, to] = dayRange(day);
    const { completed, covered } = await withActor(admin, async (tx) => {
      const done = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.status, "completed"),
            gte(appointments.startsAt, from),
            lt(appointments.startsAt, to),
          ),
        );
      const ev = await tx
        .select({ id: packageSessionEvents.appointmentId })
        .from(packageSessionEvents)
        .where(eq(packageSessionEvents.kind, "deduction"));
      const ids = new Set(ev.map((e) => e.id));
      return { completed: done.length, covered: done.filter((d) => ids.has(d.id)).length };
    });
    const r = await withActor(admin, (tx) => dailyInvoicingCsv(tx, admin, day, null));
    const [header, ...rows] = parseCsv(r.csv);
    expect(header).toEqual(DAILY_COLUMNS);
    const visits = rows.filter((x) => x[0] === "visit");
    const ref = DAILY_COLUMNS.indexOf("reference");
    // One or more lines per visit (its invoice codes), every completed visit listed.
    expect(new Set(visits.map((v) => v[ref])).size).toBe(completed);
    const amount = DAILY_COLUMNS.indexOf("amount_sar");
    const paidBy = DAILY_COLUMNS.indexOf("paid_by");
    const fromPackage = visits.filter((v) => v[paidBy]!.startsWith("package"));
    expect(new Set(fromPackage.map((v) => v[ref])).size).toBe(covered);
    for (const v of fromPackage) expect(v[amount]).toBe("0.00");
    // Nothing clinical in the file.
    expect(r.csv).not.toMatch(/diagnos/i);
  });

  it("includes reception's checkout: amount, method and the clinic's invoice number", async () => {
    // Demo: D-0019's past Botox visit, checked out by card as INV-2026-0412.
    const id = demoId("derma:appointment:d0019-botox-past");
    const [a] = await withActor(admin, (tx) =>
      tx
        .select({ startsAt: appointments.startsAt })
        .from(appointments)
        .where(eq(appointments.id, id)),
    );
    const r = await withActor(admin, (tx) =>
      dailyInvoicingCsv(tx, admin, riyadhDay(a!.startsAt), null),
    );
    const [, ...rows] = parseCsv(r.csv);
    const col = (name: string) => DAILY_COLUMNS.indexOf(name);
    const mine = rows.filter((x) => x[col("reference")] === id.slice(0, 8));
    const lines = mine.filter((x) => x[0] === "visit");
    const [pay] = mine.filter((x) => x[0] === "visit_payment");
    expect(lines.length).toBeGreaterThan(0);
    for (const l of lines) expect(l[col("clinic_invoice_no")]).toBe("INV-2026-0412");
    expect(pay).toBeDefined();
    expect(pay![col("paid_by")]).toBe("card");
    expect(pay![col("clinic_invoice_no")]).toBe("INV-2026-0412");
    // Paid = the sum of the visit's lines.
    const lineTotal = lines.reduce((sum, l) => sum + Number(l[col("amount_sar")]), 0);
    expect(Number(pay![col("amount_sar")])).toBeCloseTo(lineTotal, 2);
  });

  it("is for clinic admins only", async () => {
    await expect(
      withActor(reception, (tx) => dailyInvoicingCsv(tx, reception, "2026-01-01", null)),
    ).rejects.toThrow(PermissionError);
  });
});
