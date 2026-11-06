import "server-only";
/**
 * Support access — given by the clinic, never taken by the platform. A clinic admin allows the
 * platform's support to open the clinic for a few hours (view only, or view and change), and can
 * end it at any time. During it, the platform owner works as a clinic admin (no clinical notes:
 * those need the practitioner role) and every page they open is written to the clinic's audit log.
 * The database enforces it too: without an active grant, a platform owner's queries see no patient
 * data at all (app_platform_gate() in db/rls.sql).
 */
import { and, desc, eq, gt, inArray, isNull, sql } from "drizzle-orm";
import { auditLogs, supportGrants, users } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan, PermissionError } from "@/lib/auth/permissions";

export const SUPPORT_HOURS = [1, 4, 24, 72] as const;

export class SupportError extends Error {
  constructor(public code: "already_active" | "none_active") {
    super(code);
  }
}

export type SupportGrant = typeof supportGrants.$inferSelect;

/** The grant in force right now (newest), or null. */
export async function activeGrant(tx: TenantTx, now: Date = new Date()) {
  const [g] = await tx
    .select()
    .from(supportGrants)
    .where(and(isNull(supportGrants.revokedAt), gt(supportGrants.expiresAt, now)))
    .orderBy(desc(supportGrants.expiresAt))
    .limit(1);
  return g ?? null;
}

export async function grantSupport(
  tx: TenantTx,
  actor: Actor,
  input: { hours: number; allowChanges: boolean; reason?: string | null },
) {
  assertCan(actor.roles, "support:grant");
  // Support can never give itself access (also refused by the database).
  if (actor.roles.includes("platform_owner")) throw new PermissionError("support:grant");
  if (await activeGrant(tx)) throw new SupportError("already_active");
  const hours = Math.min(Math.max(Math.round(input.hours), 1), 72);
  const [g] = await tx
    .insert(supportGrants)
    .values({
      tenantId: actor.tenantId,
      grantedBy: actor.userId,
      reason: input.reason?.trim() || null,
      allowChanges: input.allowChanges,
      expiresAt: sql`now() + make_interval(hours => ${hours})`,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "support.granted",
    entityType: "support_grant",
    entityId: g.id,
    metadata: { hours, allowChanges: input.allowChanges },
  });
  return g;
}

export async function endSupport(tx: TenantTx, actor: Actor) {
  assertCan(actor.roles, "support:grant");
  if (actor.roles.includes("platform_owner")) throw new PermissionError("support:grant");
  const g = await activeGrant(tx);
  if (!g) throw new SupportError("none_active");
  await tx
    .update(supportGrants)
    .set({ revokedAt: sql`now()`, revokedBy: actor.userId })
    .where(eq(supportGrants.id, g.id));
  await audit(tx, {
    actorUserId: actor.userId,
    action: "support.ended",
    entityType: "support_grant",
    entityId: g.id,
  });
}

/** What support did in this clinic recently (for the clinic admin): pages opened, changes made. */
export async function supportActivity(tx: TenantTx, limit = 15) {
  return tx
    .select({
      at: auditLogs.createdAt,
      action: auditLogs.action,
      metadata: auditLogs.metadata,
    })
    .from(auditLogs)
    .innerJoin(users, eq(users.id, auditLogs.actorUserId))
    .where(
      and(
        eq(users.isPlatformOwner, true),
        inArray(auditLogs.action, ["support.view", "support.change"]),
      ),
    )
    .orderBy(desc(auditLogs.createdAt))
    .limit(limit);
}
