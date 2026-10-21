/**
 * Packages and session balances. The balance (sessions_used) changes ONLY by inserting a
 * package_session_events row; a database trigger applies it and a CHECK keeps it between
 * 0 and the total. Check-in deduction is idempotent: one per appointment (unique index).
 */
import { and, asc, eq, gt, inArray, lt, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  packagePayments,
  packageSessionEvents,
  packageTemplates,
  patientPackages,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";

export type PatientPackage = typeof patientPackages.$inferSelect;
export type PackagePayment = typeof packagePayments.$inferSelect;

export class PackageError extends Error {
  constructor(
    public code: "not_found" | "overpaid" | "reason_required" | "no_balance" | "bad_amount",
  ) {
    super(code);
    this.name = "PackageError";
  }
}

export type PaymentStatus = "paid" | "partial" | "outstanding";

export function paymentSummary(priceHalalas: number, payments: { amountHalalas: number }[]) {
  const paid = payments.reduce((s, p) => s + p.amountHalalas, 0);
  const outstanding = Math.max(0, priceHalalas - paid);
  const status: PaymentStatus = outstanding === 0 ? "paid" : paid > 0 ? "partial" : "outstanding";
  return { paid, outstanding, status };
}

export function remaining(pkg: Pick<PatientPackage, "sessionsTotal" | "sessionsUsed">) {
  return pkg.sessionsTotal - pkg.sessionsUsed;
}

export function isUsable(pkg: PatientPackage, now = new Date()) {
  return remaining(pkg) > 0 && pkg.expiresAt > now;
}

async function savepoint<T>(tx: TenantTx, fn: (sp: TenantTx) => Promise<T>) {
  return tx.transaction(fn);
}

function dbCode(err: unknown) {
  const e = err as { code?: string; cause?: { code?: string } };
  return e?.cause?.code ?? e?.code;
}

export async function sellPackage(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    templateId: string;
    payment?: { amountHalalas: number; method: "cash" | "card" | "transfer" };
  },
) {
  assertCan(actor.roles, "packages:sell");
  const [tpl] = await tx
    .select()
    .from(packageTemplates)
    .where(eq(packageTemplates.id, input.templateId))
    .limit(1);
  if (!tpl || !tpl.isActive) throw new PackageError("not_found");
  const now = new Date();
  const [pkg] = await tx
    .insert(patientPackages)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      templateId: tpl.id,
      serviceId: tpl.serviceId,
      nameAr: tpl.nameAr,
      nameEn: tpl.nameEn,
      sessionsTotal: tpl.sessionsCount,
      priceHalalas: tpl.priceHalalas,
      purchasedAt: now,
      expiresAt: new Date(now.getTime() + tpl.validityDays * 86400_000),
      soldBy: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "package.sell",
    entityType: "patient_package",
    entityId: pkg.id,
    metadata: { patientId: input.patientId, templateId: tpl.id, priceHalalas: tpl.priceHalalas },
  });
  if (input.payment && input.payment.amountHalalas > 0) {
    await recordPayment(tx, actor, { patientPackageId: pkg.id, ...input.payment });
  }
  return pkg;
}

export async function recordPayment(
  tx: TenantTx,
  actor: Actor,
  input: { patientPackageId: string; amountHalalas: number; method: "cash" | "card" | "transfer" },
) {
  assertCan(actor.roles, "packages:sell");
  if (!Number.isInteger(input.amountHalalas) || input.amountHalalas <= 0)
    throw new PackageError("bad_amount");
  const [pkg] = await tx
    .select()
    .from(patientPackages)
    .where(eq(patientPackages.id, input.patientPackageId))
    .for("update")
    .limit(1);
  if (!pkg) throw new PackageError("not_found");
  const payments = await tx
    .select()
    .from(packagePayments)
    .where(eq(packagePayments.patientPackageId, pkg.id));
  if (input.amountHalalas > paymentSummary(pkg.priceHalalas, payments).outstanding) {
    throw new PackageError("overpaid");
  }
  const [payment] = await tx
    .insert(packagePayments)
    .values({
      tenantId: actor.tenantId,
      patientPackageId: pkg.id,
      amountHalalas: input.amountHalalas,
      method: input.method,
      recordedBy: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "package.payment",
    entityType: "patient_package",
    entityId: pkg.id,
    metadata: { amountHalalas: input.amountHalalas, method: input.method },
  });
  return payment;
}

/**
 * Deducts one session for a visit, from the patient's usable package for that service
 * (the one expiring soonest). Safe to call any number of times: deducts at most once.
 */
export async function deductForAppointment(
  tx: TenantTx,
  actor: Actor,
  appt: { id: string; patientId: string; serviceId: string },
): Promise<{
  deducted: boolean;
  alreadyDeducted: boolean;
  packageId: string | null;
  remaining: number | null;
}> {
  const [existing] = await tx
    .select({ packageId: packageSessionEvents.patientPackageId })
    .from(packageSessionEvents)
    .where(
      and(
        eq(packageSessionEvents.appointmentId, appt.id),
        eq(packageSessionEvents.kind, "deduction"),
      ),
    )
    .limit(1);
  if (existing) {
    const [pkg] = await tx
      .select()
      .from(patientPackages)
      .where(eq(patientPackages.id, existing.packageId));
    return { deducted: false, alreadyDeducted: true, packageId: pkg.id, remaining: remaining(pkg) };
  }

  const now = new Date();
  const [pkg] = await tx
    .select()
    .from(patientPackages)
    .where(
      and(
        eq(patientPackages.patientId, appt.patientId),
        eq(patientPackages.serviceId, appt.serviceId),
        lt(patientPackages.sessionsUsed, patientPackages.sessionsTotal),
        gt(patientPackages.expiresAt, now),
      ),
    )
    .orderBy(asc(patientPackages.expiresAt))
    .for("update")
    .limit(1);
  if (!pkg) return { deducted: false, alreadyDeducted: false, packageId: null, remaining: null };

  try {
    await savepoint(tx, (sp) =>
      sp.insert(packageSessionEvents).values({
        tenantId: actor.tenantId,
        patientPackageId: pkg.id,
        appointmentId: appt.id,
        kind: "deduction",
        delta: 1,
        createdBy: actor.userId,
      }),
    );
  } catch (err) {
    if (dbCode(err) === "23505") {
      // Someone else deducted for this visit at the same moment: nothing more to do.
      return {
        deducted: false,
        alreadyDeducted: true,
        packageId: pkg.id,
        remaining: remaining(pkg) - 1,
      };
    }
    throw err;
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "package.deduct",
    entityType: "patient_package",
    entityId: pkg.id,
    metadata: { appointmentId: appt.id, before: remaining(pkg), after: remaining(pkg) - 1 },
  });
  return {
    deducted: true,
    alreadyDeducted: false,
    packageId: pkg.id,
    remaining: remaining(pkg) - 1,
  };
}

/** Staff correction: delta +1 uses a session, -1 gives one back. Reason is mandatory and audited. */
export async function overrideSessions(
  tx: TenantTx,
  actor: Actor,
  input: { patientPackageId: string; delta: 1 | -1; reason: string },
) {
  assertCan(actor.roles, "packages:override");
  const reason = input.reason.trim();
  if (reason.length < 3) throw new PackageError("reason_required");
  const [pkg] = await tx
    .select()
    .from(patientPackages)
    .where(eq(patientPackages.id, input.patientPackageId))
    .for("update")
    .limit(1);
  if (!pkg) throw new PackageError("not_found");
  try {
    await savepoint(tx, (sp) =>
      sp.insert(packageSessionEvents).values({
        tenantId: actor.tenantId,
        patientPackageId: pkg.id,
        kind: "override",
        delta: input.delta,
        reason,
        createdBy: actor.userId,
      }),
    );
  } catch (err) {
    if (dbCode(err) === "23514") throw new PackageError("no_balance"); // CHECK: below 0 or above total
    throw err;
  }
  await audit(tx, {
    actorUserId: actor.userId,
    action: "package.override",
    entityType: "patient_package",
    entityId: pkg.id,
    metadata: {
      delta: input.delta,
      reason,
      before: remaining(pkg),
      after: remaining(pkg) - input.delta,
    },
  });
}

/** Packages per patient (for profile, calendar and My Day badges). */
export async function packagesForPatients(tx: TenantTx, patientIds: string[]) {
  const map = new Map<string, PatientPackage[]>();
  if (!patientIds.length) return map;
  const rows = await tx
    .select()
    .from(patientPackages)
    .where(inArray(patientPackages.patientId, [...new Set(patientIds)]))
    .orderBy(asc(patientPackages.expiresAt));
  for (const r of rows) map.set(r.patientId, [...(map.get(r.patientId) ?? []), r]);
  return map;
}

/** The usable package for a patient + service, as shown on a calendar block. */
export function balanceFor(
  map: Map<string, PatientPackage[]>,
  patientId: string,
  serviceId: string,
) {
  const pkg = (map.get(patientId) ?? []).find((p) => p.serviceId === serviceId && isUsable(p));
  return pkg ? { remaining: remaining(pkg), total: pkg.sessionsTotal, packageId: pkg.id } : null;
}

export async function paymentsFor(tx: TenantTx, packageIds: string[]) {
  if (!packageIds.length) return [];
  return tx
    .select()
    .from(packagePayments)
    .where(inArray(packagePayments.patientPackageId, packageIds))
    .orderBy(asc(packagePayments.paidAt));
}

export async function sessionEventsFor(tx: TenantTx, packageIds: string[]) {
  if (!packageIds.length) return [];
  return tx
    .select()
    .from(packageSessionEvents)
    .where(inArray(packageSessionEvents.patientPackageId, packageIds))
    .orderBy(asc(packageSessionEvents.createdAt));
}

export async function activeTemplates(tx: TenantTx) {
  return tx
    .select()
    .from(packageTemplates)
    .where(eq(packageTemplates.isActive, true))
    .orderBy(asc(packageTemplates.createdAt), sql`${packageTemplates.nameEn}`);
}
