/**
 * Memberships: the patient pays per month / quarter / year and gets some included visits of one
 * service plus a discount on everything else.
 *
 *  - The plan's terms are COPIED into the patient's period when sold, so changing a plan later
 *    never changes what a member already bought.
 *  - A renewal is a new period (a new row that `renews` the previous one); a period is only
 *    ever cancelled, never edited. Payments and used visits are append-only.
 *  - Included visit: at check-in, when no package session covered the visit, the service is the
 *    plan's service and visits are left in the period → one `membership_visits` row (unique per
 *    appointment: a second check-in never uses two).
 *  - Discount: at checkout, on the lines nothing covered, for a member on the visit day.
 */
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import {
  membershipPayments,
  membershipPlans,
  membershipVisits,
  patientMemberships,
  patients,
  services,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { addDays, riyadhDay } from "@/lib/booking/time";

export class MembershipError extends Error {
  constructor(
    public code:
      | "not_found"
      | "already_member"
      | "bad_amount"
      | "overpaid"
      | "cancelled"
      | "renewed"
      | "plan_off",
  ) {
    super(code);
    this.name = "MembershipError";
  }
}

export type PatientMembership = typeof patientMemberships.$inferSelect;
export type Method = "cash" | "card" | "transfer";
export const PERIODS = [1, 3, 6, 12] as const;

/** The last day of a period that starts on `start` (both days included). */
export function periodEnd(start: string, months: number) {
  const [y, m, d] = start.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(d, lastDay));
  return addDays(target.toISOString().slice(0, 10), -1);
}

/** Active on that day: not cancelled and the day is inside the period. */
export const isActiveOn = (m: Pick<PatientMembership, "startsOn" | "endsOn" | "cancelledAt">, day: string) =>
  !m.cancelledAt && m.startsOn <= day && day <= m.endsOn;

/** Monthly recurring income of one period (a yearly plan counts 1/12 of its price). */
export const monthlyValue = (m: { priceHalalas: number; periodMonths: number }) =>
  Math.round(m.priceHalalas / m.periodMonths);

/** The discount on the uncovered amount, rounded down to whole halalas. */
export const discountOf = (uncovered: number, percent: number) =>
  Math.floor((Math.max(0, uncovered) * Math.max(0, Math.min(50, percent))) / 100);

export async function activePlans(tx: TenantTx) {
  return tx
    .select()
    .from(membershipPlans)
    .where(eq(membershipPlans.isActive, true))
    .orderBy(asc(membershipPlans.periodMonths), asc(membershipPlans.priceHalalas));
}

/** The patient's membership on a day (the latest-starting active period), or null. */
export async function membershipOn(tx: TenantTx, patientId: string, day: string) {
  const [m] = await tx
    .select()
    .from(patientMemberships)
    .where(
      and(
        eq(patientMemberships.patientId, patientId),
        isNull(patientMemberships.cancelledAt),
        lte(patientMemberships.startsOn, day),
        gte(patientMemberships.endsOn, day),
      ),
    )
    .orderBy(desc(patientMemberships.startsOn))
    .limit(1);
  return m ?? null;
}

async function paidFor(tx: TenantTx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx
    .select({
      id: membershipPayments.patientMembershipId,
      v: sql<number>`coalesce(sum(${membershipPayments.amountHalalas}), 0)::int`,
    })
    .from(membershipPayments)
    .where(inArray(membershipPayments.patientMembershipId, ids))
    .groupBy(membershipPayments.patientMembershipId);
  return new Map(rows.map((r) => [r.id, Number(r.v)]));
}

async function usedFor(tx: TenantTx, ids: string[]) {
  if (!ids.length) return new Map<string, number>();
  const rows = await tx
    .select({
      id: membershipVisits.patientMembershipId,
      n: sql<number>`count(*)::int`,
    })
    .from(membershipVisits)
    .where(inArray(membershipVisits.patientMembershipId, ids))
    .groupBy(membershipVisits.patientMembershipId);
  return new Map(rows.map((r) => [r.id, Number(r.n)]));
}

/** All periods of a patient (newest first) with what was paid and how many visits were used. */
export async function membershipsForPatient(tx: TenantTx, patientId: string) {
  const rows = await tx
    .select({ m: patientMemberships, serviceAr: services.nameAr, serviceEn: services.nameEn })
    .from(patientMemberships)
    .leftJoin(services, eq(services.id, patientMemberships.includedServiceId))
    .where(eq(patientMemberships.patientId, patientId))
    .orderBy(desc(patientMemberships.startsOn), desc(patientMemberships.createdAt));
  const ids = rows.map((r) => r.m.id);
  const [paid, used] = await Promise.all([paidFor(tx, ids), usedFor(tx, ids)]);
  const renewed = new Set(rows.map((r) => r.m.renewsId).filter(Boolean));
  return rows.map(({ m, serviceAr, serviceEn }) => ({
    ...m,
    serviceAr,
    serviceEn,
    paidHalalas: paid.get(m.id) ?? 0,
    outstandingHalalas: Math.max(0, m.priceHalalas - (paid.get(m.id) ?? 0)),
    visitsUsed: used.get(m.id) ?? 0,
    renewed: renewed.has(m.id),
  }));
}
export type MembershipView = Awaited<ReturnType<typeof membershipsForPatient>>[number];

async function insertPeriod(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    plan: typeof membershipPlans.$inferSelect;
    startsOn: string;
    renewsId: string | null;
  },
) {
  const { plan } = input;
  const [row] = await tx
    .insert(patientMemberships)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      planId: plan.id,
      nameAr: plan.nameAr,
      nameEn: plan.nameEn,
      priceHalalas: plan.priceHalalas,
      periodMonths: plan.periodMonths,
      includedServiceId: plan.includedServiceId,
      includedVisits: plan.includedVisits,
      discountPercent: plan.discountPercent,
      startsOn: input.startsOn,
      endsOn: periodEnd(input.startsOn, plan.periodMonths),
      renewsId: input.renewsId,
      soldByUserId: actor.userId,
    })
    .returning();
  return row;
}

/** Sells a membership starting today. Not while the patient already has one running. */
export async function sellMembership(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    planId: string;
    payment?: { amountHalalas: number; method: Method; invoiceNumber?: string | null } | null;
  },
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "memberships:sell");
  const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, input.planId));
  if (!plan) throw new MembershipError("not_found");
  if (!plan.isActive) throw new MembershipError("plan_off");
  // Lock the patient row: two receptionists selling at once can't create two memberships.
  const [p] = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(eq(patients.id, input.patientId))
    .for("update");
  if (!p) throw new MembershipError("not_found");
  const running = await tx
    .select({ id: patientMemberships.id })
    .from(patientMemberships)
    .where(
      and(
        eq(patientMemberships.patientId, input.patientId),
        isNull(patientMemberships.cancelledAt),
        gte(patientMemberships.endsOn, today),
      ),
    )
    .limit(1);
  if (running.length) throw new MembershipError("already_member");
  const row = await insertPeriod(tx, actor, {
    patientId: input.patientId,
    plan,
    startsOn: today,
    renewsId: null,
  });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "membership.sell",
    entityType: "patient_membership",
    entityId: row.id,
    metadata: { patientId: input.patientId, planId: plan.id, priceHalalas: plan.priceHalalas },
  });
  if (input.payment && input.payment.amountHalalas > 0) {
    await recordMembershipPayment(tx, actor, { membershipId: row.id, ...input.payment });
  }
  return row;
}

/**
 * Renews a period with the plan's terms of today: the new period starts the day after the old
 * one ends (or today, when it already lapsed). Each period is renewed once.
 */
export async function renewMembership(
  tx: TenantTx,
  actor: Actor,
  input: {
    membershipId: string;
    payment?: { amountHalalas: number; method: Method; invoiceNumber?: string | null } | null;
  },
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "memberships:sell");
  const [old] = await tx
    .select()
    .from(patientMemberships)
    .where(eq(patientMemberships.id, input.membershipId))
    .for("update");
  if (!old) throw new MembershipError("not_found");
  if (old.cancelledAt) throw new MembershipError("cancelled");
  const [already] = await tx
    .select({ id: patientMemberships.id })
    .from(patientMemberships)
    .where(eq(patientMemberships.renewsId, old.id));
  if (already) throw new MembershipError("renewed");
  const [plan] = await tx.select().from(membershipPlans).where(eq(membershipPlans.id, old.planId));
  if (!plan?.isActive) throw new MembershipError("plan_off");
  const next = addDays(old.endsOn, 1);
  const row = await insertPeriod(tx, actor, {
    patientId: old.patientId,
    plan,
    startsOn: next > today ? next : today,
    renewsId: old.id,
  });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "membership.renew",
    entityType: "patient_membership",
    entityId: row.id,
    metadata: { renews: old.id, planId: plan.id, priceHalalas: plan.priceHalalas },
  });
  if (input.payment && input.payment.amountHalalas > 0) {
    await recordMembershipPayment(tx, actor, { membershipId: row.id, ...input.payment });
  }
  return row;
}

export async function recordMembershipPayment(
  tx: TenantTx,
  actor: Actor,
  input: { membershipId: string; amountHalalas: number; method: Method; invoiceNumber?: string | null },
) {
  assertCan(actor.roles, "memberships:sell");
  if (!Number.isInteger(input.amountHalalas) || input.amountHalalas <= 0)
    throw new MembershipError("bad_amount");
  const [m] = await tx
    .select()
    .from(patientMemberships)
    .where(eq(patientMemberships.id, input.membershipId))
    .for("update");
  if (!m) throw new MembershipError("not_found");
  const paid = (await paidFor(tx, [m.id])).get(m.id) ?? 0;
  if (input.amountHalalas > m.priceHalalas - paid) throw new MembershipError("overpaid");
  const [row] = await tx
    .insert(membershipPayments)
    .values({
      tenantId: actor.tenantId,
      patientMembershipId: m.id,
      amountHalalas: input.amountHalalas,
      method: input.method,
      invoiceNumber: input.invoiceNumber?.trim() || null,
      recordedByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "membership.payment",
    entityType: "patient_membership",
    entityId: m.id,
    metadata: {
      amountHalalas: input.amountHalalas,
      method: input.method,
      invoiceNumber: row.invoiceNumber,
    },
  });
  return row;
}

/** Ends a membership now (no refund is recorded here: that is the clinic's own invoicing). */
export async function cancelMembership(tx: TenantTx, actor: Actor, membershipId: string) {
  assertCan(actor.roles, "memberships:sell");
  const [row] = await tx
    .update(patientMemberships)
    .set({ cancelledAt: new Date(), cancelledByUserId: actor.userId })
    .where(and(eq(patientMemberships.id, membershipId), isNull(patientMemberships.cancelledAt)))
    .returning();
  if (!row) throw new MembershipError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "membership.cancel",
    entityType: "patient_membership",
    entityId: row.id,
    metadata: { patientId: row.patientId },
  });
  return row;
}

/**
 * Check-in: uses one included visit when the visit's service is the membership's service and
 * visits are left in the period. Safe to call any number of times (one per appointment).
 */
export async function takeIncludedVisit(
  tx: TenantTx,
  actor: { tenantId: string; userId: string | null },
  appt: { id: string; patientId: string; serviceId: string; startsAt: Date },
): Promise<{ used: boolean; membershipId: string | null; left: number | null }> {
  const [existing] = await tx
    .select({ id: membershipVisits.patientMembershipId })
    .from(membershipVisits)
    .where(eq(membershipVisits.appointmentId, appt.id));
  if (existing) return { used: false, membershipId: existing.id, left: null };
  const m = await membershipOn(tx, appt.patientId, riyadhDay(appt.startsAt));
  if (!m || m.includedServiceId !== appt.serviceId || m.includedVisits <= 0) {
    return { used: false, membershipId: null, left: null };
  }
  // Lock the period: two check-ins at once can't both take the last visit.
  await tx
    .select({ id: patientMemberships.id })
    .from(patientMemberships)
    .where(eq(patientMemberships.id, m.id))
    .for("update");
  const used = (await usedFor(tx, [m.id])).get(m.id) ?? 0;
  if (used >= m.includedVisits) return { used: false, membershipId: m.id, left: 0 };
  try {
    await tx.transaction((sp) =>
      sp.insert(membershipVisits).values({
        tenantId: actor.tenantId,
        patientMembershipId: m.id,
        appointmentId: appt.id,
      }),
    );
  } catch (err) {
    const e = err as { code?: string; cause?: { code?: string } };
    if ((e?.cause?.code ?? e?.code) === "23505") return { used: false, membershipId: m.id, left: null };
    throw err;
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "membership.visit",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { membershipId: m.id, left: m.includedVisits - used - 1 },
  });
  return { used: true, membershipId: m.id, left: m.includedVisits - used - 1 };
}

/** Was this visit one of the membership's included visits? */
export async function coveredByMembership(tx: TenantTx, appointmentId: string) {
  const [row] = await tx
    .select({ id: membershipVisits.id })
    .from(membershipVisits)
    .where(eq(membershipVisits.appointmentId, appointmentId))
    .limit(1);
  return !!row;
}

/** Periods ending within `days` (or lapsed in the last 30 days) and not renewed or cancelled. */
export async function renewalsDue(tx: TenantTx, today = riyadhDay(new Date()), days = 14) {
  const renewal = sql`not exists (
    select 1 from ${patientMemberships} as r
    where r.tenant_id = ${patientMemberships.tenantId} and r.renews_id = ${patientMemberships.id}
  )`;
  const newer = sql`not exists (
    select 1 from ${patientMemberships} as n
    where n.tenant_id = ${patientMemberships.tenantId} and n.patient_id = ${patientMemberships.patientId}
      and n.starts_on > ${patientMemberships.startsOn} and n.cancelled_at is null
  )`;
  return tx
    .select({
      m: patientMemberships,
      fileNumber: patients.fileNumber,
      nameAr: patients.fullNameAr,
      nameEn: patients.fullNameEn,
      phone: patients.phone,
    })
    .from(patientMemberships)
    .innerJoin(patients, eq(patients.id, patientMemberships.patientId))
    .where(
      and(
        isNull(patientMemberships.cancelledAt),
        gte(patientMemberships.endsOn, addDays(today, -30)),
        lte(patientMemberships.endsOn, addDays(today, days)),
        renewal,
        newer,
      ),
    )
    .orderBy(asc(patientMemberships.endsOn));
}

/** Members today, and the monthly recurring income of their memberships. */
export async function membershipStats(tx: TenantTx, today = riyadhDay(new Date())) {
  const active = await tx
    .select({
      m: patientMemberships,
      fileNumber: patients.fileNumber,
      nameAr: patients.fullNameAr,
      nameEn: patients.fullNameEn,
    })
    .from(patientMemberships)
    .innerJoin(patients, eq(patients.id, patientMemberships.patientId))
    .where(
      and(
        isNull(patientMemberships.cancelledAt),
        lte(patientMemberships.startsOn, today),
        gte(patientMemberships.endsOn, today),
      ),
    )
    .orderBy(asc(patientMemberships.endsOn));
  return {
    active,
    members: new Set(active.map((a) => a.m.patientId)).size,
    monthlyHalalas: active.reduce((s, a) => s + monthlyValue(a.m), 0),
  };
}

export type PeriodState = "running" | "upcoming" | "ended" | "cancelled";
export function periodState(
  m: Pick<PatientMembership, "startsOn" | "endsOn" | "cancelledAt">,
  today = riyadhDay(new Date()),
): PeriodState {
  if (m.cancelledAt) return "cancelled";
  if (today < m.startsOn) return "upcoming";
  if (today > m.endsOn) return "ended";
  return "running";
}

/** Plain values for the patient file's membership card. */
export function periodViews(rows: MembershipView[], today = riyadhDay(new Date())) {
  return rows.map((m) => ({
    id: m.id,
    nameAr: m.nameAr,
    nameEn: m.nameEn,
    priceHalalas: m.priceHalalas,
    periodMonths: m.periodMonths,
    includedVisits: m.includedVisits,
    serviceAr: m.serviceAr,
    serviceEn: m.serviceEn,
    discountPercent: m.discountPercent,
    startsOn: m.startsOn,
    endsOn: m.endsOn,
    cancelled: !!m.cancelledAt,
    renewed: m.renewed,
    paidHalalas: m.paidHalalas,
    outstandingHalalas: m.outstandingHalalas,
    visitsUsed: m.visitsUsed,
    state: periodState(m, today),
  }));
}
