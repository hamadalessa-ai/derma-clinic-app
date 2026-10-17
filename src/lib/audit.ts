import { sql } from "drizzle-orm";
import { auditLogs } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";

export interface AuditEntry {
  /** Staff user who did it; null for the system. */
  actorUserId: string | null;
  /** What happened, as "<thing>.<verb>", e.g. "patient.update", "auth.login". */
  action: string;
  /** Which kind of record, e.g. "patient". */
  entityType: string;
  /** Which record. */
  entityId?: string | null;
  /** Extra detail, e.g. changed field names. Never put passwords or full medical notes here. */
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
}

/**
 * Records who did what to which record, and when (created_at is set by the database).
 * Call it inside the SAME withTenant transaction as the change, so both succeed or both fail.
 * The clinic is taken from the transaction itself, so it can never be logged under the wrong clinic.
 */
export async function audit(tx: TenantTx, entry: AuditEntry) {
  const [row] = await tx
    .insert(auditLogs)
    .values({
      tenantId: sql`public.app_current_tenant()`,
      actorUserId: entry.actorUserId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      metadata: entry.metadata ?? {},
      ipAddress: entry.ipAddress ?? null,
    })
    .returning();
  return row;
}

/** For events that aren't part of a data change (e.g. a login). */
export function auditEvent(tenantId: string, entry: AuditEntry) {
  return withTenant(tenantId, (tx) => audit(tx, entry));
}
