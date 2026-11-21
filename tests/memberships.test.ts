/**
 * Memberships: plans (set-up), selling + payments, an included visit used once at check-in,
 * the member discount at checkout (and in the daily file), renewal, cancelling, the WhatsApp
 * reminder 3 days before the end, the renewals list, the stats and the patient page.
 */
import { afterAll, describe, expect, it } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { demoId } from "@/db/seed-data";
import { messages, patientMemberships, visitCheckouts } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment } from "@/lib/booking/engine";
import {
  cancelMembership,
  discountOf,
  MembershipError,
  membershipStats,
  monthlyValue,
  periodEnd,
  periodState,
  recordMembershipPayment,
  renewalsDue,
  renewMembership,
  sellMembership,
} from "@/lib/memberships/memberships";
import { loadPortal } from "@/lib/portal/data";
import { dailyInvoicingCsv } from "@/lib/reports/daily-export";
import { saveMembershipPlan } from "@/lib/setup/admin";
import { checkIn } from "@/lib/visits/check-in";
import { checkOut, checkoutData } from "@/lib/visits/checkout";
import { addCharge, postVisit, startVisit, visitExtras } from "@/lib/visits/visit";
import { runScheduledMessages } from "@/lib/whatsapp/scheduler";
import {
  admin,
  DERMA,
  drSara,
  LAMSA,
  member,
  nurse,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

afterAll(closeDb);

const FILE = "D-0035";
const SOLD_ON = "2036-05-01";
const DAY = "2036-05-11"; // a Sunday no other test uses
const BTX = demoId("derma:billing_item:BTX-U");
const derma = { id: DERMA, slug: "derma", isDemo: true };
const ENV = { ...process.env, MESSAGE_DEMO_MODE: "on" };

const code = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    if (e instanceof MembershipError) return e.code;
    if (e instanceof PermissionError) return "not_allowed";
    throw e;
  }
  return "ok";
};

describe("periods and money (pure)", () => {
  it("a period ends the day before the same date next period", () => {
    expect(periodEnd("2036-03-15", 1)).toBe("2036-04-14");
    expect(periodEnd("2036-03-15", 12)).toBe("2037-03-14");
    expect(periodEnd("2036-01-31", 1)).toBe("2036-02-28"); // 29 Feb 2036 exists → ends the 28th
    expect(periodEnd("2036-12-01", 3)).toBe("2037-02-28");
  });
  it("state, discount and monthly value", () => {
    const m = { startsOn: "2036-05-01", endsOn: "2036-05-31", cancelledAt: null };
    expect(periodState(m, "2036-04-30")).toBe("upcoming");
    expect(periodState(m, "2036-05-31")).toBe("running");
    expect(periodState(m, "2036-06-01")).toBe("ended");
    expect(periodState({ ...m, cancelledAt: new Date() }, "2036-05-10")).toBe("cancelled");
    expect(discountOf(5000, 10)).toBe(500);
    expect(discountOf(999, 15)).toBe(149); // rounded down
    expect(discountOf(1000, 90)).toBe(500); // never more than 50%
    expect(monthlyValue({ priceHalalas: 299000, periodMonths: 12 })).toBe(24917);
  });
});

describe("selling, a visit, the discount, renewing", () => {
  let planId = "";
  let membershipId = "";

  it("admin creates a plan; reception sells it once; payments can't exceed the price", async () => {
    const plan = await withActor(admin, (tx) =>
      saveMembershipPlan(tx, admin, {
        nameAr: "عضوية اختبار",
        nameEn: "Test membership",
        priceHalalas: 30000,
        periodMonths: 1,
        includedServiceId: service("consultation"),
        includedVisits: 1,
        discountPercent: 10,
        isActive: true,
      }),
    );
    planId = plan.id;
    expect(
      await code(
        withActor(nurse, (tx) =>
          sellMembership(tx, nurse, { patientId: patient(FILE), planId }, SOLD_ON),
        ),
      ),
    ).toBe("not_allowed");
    const m = await withActor(reception, (tx) =>
      sellMembership(
        tx,
        reception,
        { patientId: patient(FILE), planId, payment: { amountHalalas: 10000, method: "card" } },
        SOLD_ON,
      ),
    );
    membershipId = m.id;
    expect(m).toMatchObject({ startsOn: SOLD_ON, endsOn: "2036-05-31", priceHalalas: 30000 });
    expect(
      await code(
        withActor(reception, (tx) =>
          sellMembership(tx, reception, { patientId: patient(FILE), planId }, SOLD_ON),
        ),
      ),
    ).toBe("already_member");
    expect(
      await code(
        withActor(reception, (tx) =>
          recordMembershipPayment(tx, reception, {
            membershipId,
            amountHalalas: 25000,
            method: "cash",
          }),
        ),
      ),
    ).toBe("overpaid");
    await withActor(reception, (tx) =>
      recordMembershipPayment(tx, reception, {
        membershipId,
        amountHalalas: 20000,
        method: "cash",
        invoiceNumber: "INV-M-1",
      }),
    );
  });

  it("check-in uses the included visit once; the next visit pays, less 10%", async () => {
    const book = (time: string) =>
      withActor(reception, (tx) =>
        bookAppointment(tx, reception, {
          branchId: RIYADH,
          patientId: patient(FILE),
          serviceId: service("consultation"),
          practitionerId: member("derma-dr-sara"),
          startsAt: riyadhAt(time, DAY),
        }),
      );
    const first = await book("10:00");
    const r1 = await withActor(reception, (tx) => checkIn(tx, reception, first.id));
    expect(r1).toMatchObject({ status: "checked_in", membershipVisit: true });
    expect((await withActor(reception, (tx) => checkIn(tx, reception, first.id))).status).toBe(
      "already_checked_in",
    );
    const { noteId } = await withActor(drSara, (tx) => startVisit(tx, drSara, first.id));
    await withActor(drSara, (tx) =>
      addCharge(tx, drSara, { appointmentId: first.id, billingItemId: BTX, quantity: 4 }),
    );
    const { charges } = await withTenant(DERMA, (tx) => visitExtras(tx, first.id));
    const consult = charges.find((c) => c.serviceId === service("consultation"))!;
    expect(consult).toMatchObject({ coveredByPackage: true, coveredByMembership: true });
    await withActor(drSara, (tx) =>
      postVisit(tx, drSara, { appointmentId: first.id, noteId, body: "Done." }),
    );
    const d = await withActor(reception, (tx) => checkoutData(tx, reception, first.id));
    expect(d.gross).toBe(4 * 2500); // the consultation was included
    expect(d.discount).toBe(1000);
    expect(d.due).toBe(9000);
    expect(d.membership?.discountPercent).toBe(10);
    await withActor(reception, (tx) =>
      checkOut(tx, reception, { appointmentId: first.id, paidHalalas: 9000, method: "card" }),
    );
    const [row] = await withTenant(DERMA, (tx) =>
      tx.select().from(visitCheckouts).where(eq(visitCheckouts.appointmentId, first.id)),
    );
    expect(row).toMatchObject({ dueHalalas: 9000, discountHalalas: 1000, paidHalalas: 9000 });

    // The daily file shows the discount as its own (negative) line.
    const file = await withActor(admin, (tx) => dailyInvoicingCsv(tx, admin, DAY, null));
    expect(file.csv).toContain("membership_discount");
    expect(file.csv).toContain("-10.00");

    // The one included visit is used: the second consultation is not covered.
    const second = await book("11:00");
    const r2 = await withActor(reception, (tx) => checkIn(tx, reception, second.id));
    expect(r2).toMatchObject({ status: "checked_in", membershipVisit: false });
  });

  it("WhatsApp reminder 3 days before the end, once; on the renewals list", async () => {
    const opts = { now: riyadhAt("10:00", "2036-05-28"), env: ENV, ignoreQuietHours: true };
    await runScheduledMessages(derma, opts);
    await runScheduledMessages(derma, opts);
    const sent = await withTenant(DERMA, (tx) =>
      tx
        .select()
        .from(messages)
        .where(and(eq(messages.kind, "membership_renewal"), eq(messages.patientId, patient(FILE)))),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0].body).toMatch(/عضوية اختبار|Test membership/);
    const due = await withActor(reception, (tx) => renewalsDue(tx, "2036-05-25"));
    expect(due.map((r) => r.m.id)).toContain(membershipId);
    const stats = await withActor(reception, (tx) => membershipStats(tx, "2036-05-15"));
    expect(stats.active.map((a) => a.m.id)).toContain(membershipId);
    expect(stats.monthlyHalalas).toBeGreaterThanOrEqual(30000);
  });

  it("renews once (the next period starts the day after); cancelling is final", async () => {
    const next = await withActor(reception, (tx) =>
      renewMembership(tx, reception, { membershipId }, SOLD_ON),
    );
    expect(next).toMatchObject({ startsOn: "2036-06-01", endsOn: "2036-06-30", renewsId: membershipId });
    expect(
      await code(withActor(reception, (tx) => renewMembership(tx, reception, { membershipId }, SOLD_ON))),
    ).toBe("renewed");
    const due = await withActor(reception, (tx) => renewalsDue(tx, "2036-05-25"));
    expect(due.map((r) => r.m.id)).not.toContain(membershipId);
    await withActor(reception, (tx) => cancelMembership(tx, reception, next.id));
    expect(
      await code(withActor(reception, (tx) => cancelMembership(tx, reception, next.id))),
    ).toBe("not_found");
    // The database keeps a cancelled period cancelled, and never lets the app edit its terms.
    await expect(
      withActor(admin, (tx) =>
        tx.execute(sql`update patient_memberships set cancelled_at = null where id = ${next.id}`),
      ),
    ).rejects.toThrow();
    await expect(
      withActor(admin, (tx) =>
        tx.execute(sql`update patient_memberships set price_halalas = 1 where id = ${next.id}`),
      ),
    ).rejects.toThrow();
  });

  it("the patient sees their membership on /my; another clinic never sees it", async () => {
    const mine = await loadPortal(DERMA, patient(FILE));
    expect(mine.memberships.map((m) => m.id)).toContain(membershipId);
    const other = await loadPortal(DERMA, patient("D-0001"));
    expect(other.memberships.every((m) => m.patientId !== patient(FILE))).toBe(true);
    const leak = await withTenant(LAMSA, (tx) =>
      tx.select().from(patientMemberships).where(eq(patientMemberships.id, membershipId)),
    );
    expect(leak).toHaveLength(0);
  });
});

describe("demo data", () => {
  it("has members, monthly income and renewals due around today", async () => {
    const { stats, due } = await withActor(reception, async (tx) => ({
      stats: await membershipStats(tx),
      due: await renewalsDue(tx),
    }));
    expect(stats.members).toBeGreaterThanOrEqual(3);
    expect(stats.monthlyHalalas).toBeGreaterThan(0);
    const files = due.map((r) => r.fileNumber);
    expect(files).toEqual(expect.arrayContaining(["D-0011", "D-0020"]));
  });
});
