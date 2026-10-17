import { sql } from "drizzle-orm";
import { getDb, type Database } from "./client";

export type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Runs `fn` inside a transaction where Postgres knows the current clinic.
 *
 * `set_config(..., true)` is transaction-local: it disappears at COMMIT/ROLLBACK, so the
 * setting can never leak to another request that reuses the same pooled connection.
 * This is also why it works with Supabase's transaction pooler.
 *
 * Every query for clinic data MUST go through this helper. Without it, RLS returns no rows.
 */
export async function withTenant<T>(
  tenantId: string,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  if (!UUID_RE.test(tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select set_config('app.tenant_id', ${tenantId}, true)`);
    return fn(tx);
  });
}
