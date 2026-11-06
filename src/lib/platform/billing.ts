import "server-only";
/**
 * Platform billing, recorded by hand for now (bank transfer etc.): a clinic's plan and price, a
 * monthly statement (amount + 15 % VAT), payments against it, and the rule that an unpaid
 * statement past its due date + grace days makes the clinic read-only until it is paid
 * (database function app_billing_enforce()). These are payment records, NOT ZATCA tax invoices.
 *
 * Writes run in the clinic's own context with the role "platform_owner"; the database refuses
 * billing writes without it (so clinic staff can never mark themselves as paid).
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { platformPayments, platformStatements, tenants } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import { assertCan, type Role } from "@/lib/auth/permissions";
import { addDays, riyadhDay } from "@/lib/booking/time";
import type { ClinicStatus } from "@/lib/tenant/status";
import { vatOf, type PlanTier } from "./plans";

export class BillingError extends Error {
  constructor(public code: "not_found" | "not_open" | "too_much" | "exists" | "free") {
    super(code);
  }
}

type Owner = { userId: string; roles: readonly Role[] };
type PaymentMethod = "cash" | "card" | "transfer";

/** Platform work inside one clinic: the database sees the platform owner role (or the daily job). */
function asPlatform<T>(tenantId: string, userId: string | null, fn: (tx: TenantTx) => Promise<T>) {
  return withTenant({ tenantId, userId, roles: ["platform_owner"] }, fn);
}

/** "2026-11" → first and last day of that month. */
export function monthPeriod(day: string) {
  const start = `${day.slice(0, 7)}-01`;
  const next = addDays(start, 32).slice(0, 7);
  return { start, end: addDays(`${next}-01`, -1) };
}

async function enforce(tx: TenantTx, tenantId: string): Promise<ClinicStatus> {
  const rows = await tx.execute<{ status: ClinicStatus }>(
    sql`select public.app_billing_enforce(${tenantId}::uuid) as status`,
  );
  return rows[0]?.status ?? "active";
}

async function issue(
  tx: TenantTx,
  tenant: { id: string; slug: string; monthlyPriceHalalas: number },
  input: { periodDay: string; amountHalalas?: number; dueOn?: string; note?: string | null },
  createdBy: string | null,
) {
  const { start, end } = monthPeriod(input.periodDay);
  const [live] = await tx
    .select({ id: platformStatements.id })
    .from(platformStatements)
    .where(
      and(
        eq(platformStatements.periodStart, start),
        inArray(platformStatements.status, ["issued", "paid"]),
      ),
    );
  if (live) throw new BillingError("exists");
  const amount = input.amountHalalas ?? tenant.monthlyPriceHalalas;
  const vat = vatOf(amount);
  const [{ n }] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(platformStatements)
    .where(eq(platformStatements.periodStart, start));
  const today = riyadhDay(new Date());
  const [row] = await tx
    .insert(platformStatements)
    .values({
      tenantId: tenant.id,
      number: `${tenant.slug.toUpperCase()}-${start.slice(0, 7).replace("-", "")}-${Number(n) + 1}`,
      periodStart: start,
      periodEnd: end,
      amountHalalas: amount,
      vatHalalas: vat,
      totalHalalas: amount + vat,
      dueOn: input.dueOn ?? addDays(today, 7),
      note: input.note?.trim() || null,
      createdBy,
    })
    .returning();
  await audit(tx, {
    actorUserId: createdBy,
    action: "billing.statement_issued",
    entityType: "platform_statement",
    entityId: row.id,
    metadata: { number: row.number, total: row.totalHalalas, dueOn: row.dueOn },
  });
  return row;
}

async function tenantRow(tenantId: string) {
  const [t] = await getDb().select().from(tenants).where(eq(tenants.id, tenantId));
  if (!t) throw new BillingError("not_found");
  return t;
}

/** Platform owner → issue a statement for a month (defaults: this month, the clinic's price). */
export async function issueStatement(
  owner: Owner,
  tenantId: string,
  input: { periodDay?: string; amountHalalas?: number; dueOn?: string; note?: string | null } = {},
) {
  assertCan(owner.roles, "platform:billing");
  const t = await tenantRow(tenantId);
  if ((input.amountHalalas ?? t.monthlyPriceHalalas) <= 0) throw new BillingError("free");
  return asPlatform(tenantId, owner.userId, (tx) =>
    issue(tx, t, { ...input, periodDay: input.periodDay ?? riyadhDay(new Date()) }, owner.userId),
  );
}

/** Platform owner → money received for a statement. Paid in full → "paid"; may lift a billing pause. */
export async function recordStatementPayment(
  owner: Owner,
  tenantId: string,
  input: {
    statementId: string;
    amountHalalas: number;
    method: PaymentMethod;
    reference?: string | null;
    receivedOn?: string;
  },
) {
  assertCan(owner.roles, "platform:billing");
  return asPlatform(tenantId, owner.userId, async (tx) => {
    const [st] = await tx
      .select()
      .from(platformStatements)
      .where(eq(platformStatements.id, input.statementId))
      .for("update");
    if (!st) throw new BillingError("not_found");
    if (st.status !== "issued") throw new BillingError("not_open");
    const [{ paid }] = await tx
      .select({ paid: sql<number>`coalesce(sum(${platformPayments.amountHalalas}), 0)::int` })
      .from(platformPayments)
      .where(eq(platformPayments.statementId, st.id));
    const remaining = st.totalHalalas - Number(paid);
    if (input.amountHalalas <= 0 || input.amountHalalas > remaining)
      throw new BillingError("too_much");
    await tx.insert(platformPayments).values({
      tenantId,
      statementId: st.id,
      amountHalalas: input.amountHalalas,
      method: input.method,
      reference: input.reference?.trim() || null,
      receivedOn: input.receivedOn ?? riyadhDay(new Date()),
      recordedBy: owner.userId,
    });
    const settled = input.amountHalalas === remaining;
    if (settled) {
      await tx
        .update(platformStatements)
        .set({ status: "paid", paidAt: sql`now()` })
        .where(eq(platformStatements.id, st.id));
    }
    await audit(tx, {
      actorUserId: owner.userId,
      action: "billing.payment",
      entityType: "platform_statement",
      entityId: st.id,
      metadata: { amount: input.amountHalalas, method: input.method, settled },
    });
    return { settled, status: await enforce(tx, tenantId) };
  });
}

/** Platform owner → cancel a statement issued by mistake (only if nothing was paid on it). */
export async function voidStatement(owner: Owner, tenantId: string, statementId: string) {
  assertCan(owner.roles, "platform:billing");
  return asPlatform(tenantId, owner.userId, async (tx) => {
    const [st] = await tx
      .select()
      .from(platformStatements)
      .where(eq(platformStatements.id, statementId))
      .for("update");
    if (!st) throw new BillingError("not_found");
    if (st.status !== "issued") throw new BillingError("not_open");
    const [pay] = await tx
      .select({ id: platformPayments.id })
      .from(platformPayments)
      .where(eq(platformPayments.statementId, st.id))
      .limit(1);
    if (pay) throw new BillingError("not_open");
    await tx
      .update(platformStatements)
      .set({ status: "void", voidedAt: sql`now()` })
      .where(eq(platformStatements.id, st.id));
    await audit(tx, {
      actorUserId: owner.userId,
      action: "billing.statement_void",
      entityType: "platform_statement",
      entityId: st.id,
      metadata: { number: st.number },
    });
    return { status: await enforce(tx, tenantId) };
  });
}

/** Platform owner → plan, monthly price (halalas, before VAT), trial end, grace days. */
export async function setClinicPlan(
  owner: Owner,
  tenantId: string,
  input: { plan: PlanTier; priceHalalas: number; trialEndsOn: string | null; graceDays: number },
) {
  assertCan(owner.roles, "platform:billing");
  return asPlatform(tenantId, owner.userId, async (tx) => {
    await tx.execute(
      sql`select public.app_set_clinic_plan(${tenantId}::uuid, ${input.plan}::public.plan_tier,
            ${input.priceHalalas}::integer, ${input.trialEndsOn}::date, ${input.graceDays}::integer)`,
    );
    await audit(tx, {
      actorUserId: owner.userId,
      action: "billing.plan",
      entityType: "tenant",
      entityId: tenantId,
      metadata: input,
    });
  });
}

export interface StatementView {
  id: string;
  number: string;
  periodStart: string;
  totalHalalas: number;
  paidHalalas: number;
  dueOn: string;
  status: "issued" | "paid" | "void";
  overdue: boolean;
}

/** A clinic's statements, newest first, with what was paid (the owner, or the clinic's own admin). */
export async function statementsIn(tx: TenantTx, today = riyadhDay(new Date())) {
  const rows = await tx
    .select()
    .from(platformStatements)
    .orderBy(desc(platformStatements.periodStart), desc(platformStatements.createdAt));
  const pays = await tx
    .select({ statementId: platformPayments.statementId, amount: platformPayments.amountHalalas })
    .from(platformPayments)
    .orderBy(asc(platformPayments.createdAt));
  return rows.map(
    (r): StatementView => ({
      id: r.id,
      number: r.number,
      periodStart: r.periodStart,
      totalHalalas: r.totalHalalas,
      paidHalalas: pays.filter((p) => p.statementId === r.id).reduce((n, p) => n + p.amount, 0),
      dueOn: r.dueOn,
      status: r.status,
      overdue: r.status === "issued" && r.dueOn < today,
    }),
  );
}

export const statementsOf = (tenantId: string) =>
  withTenant(tenantId, (tx) => statementsIn(tx));

/**
 * The daily job: for every LIVE (not demo) clinic with a price, past its trial and not closed or
 * suspended, issue this month's statement if it has none; then apply the overdue rule.
 */
export async function runBilling(now: Date = new Date()) {
  const today = riyadhDay(now);
  const rows = await getDb().select().from(tenants).where(eq(tenants.isDemo, false));
  const out: Record<string, string> = {};
  for (const t of rows) {
    out[t.slug] = await asPlatform(t.id, null, async (tx) => {
      let issued = false;
      const billable =
        t.monthlyPriceHalalas > 0 &&
        (!t.trialEndsOn || t.trialEndsOn < today) &&
        (t.status === "active" || t.status === "read_only");
      if (billable) {
        const { start } = monthPeriod(today);
        const [has] = await tx
          .select({ id: platformStatements.id })
          .from(platformStatements)
          .where(eq(platformStatements.periodStart, start))
          .limit(1);
        if (!has) {
          await issue(tx, t, { periodDay: today }, null);
          issued = true;
        }
      }
      const status = await enforce(tx, t.id);
      return issued ? `issued, ${status}` : status;
    });
  }
  return out;
}
