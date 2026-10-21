import { sql } from "drizzle-orm";
import { getDb, type Database } from "./client";

export type TenantTx = Parameters<Parameters<Database["transaction"]>[0]>[0];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ROLE_RE = /^[a-z_]+$/;
const USER_RE = /^[A-Za-z0-9_-]{1,100}$/;

/** What the database is told about the current request (see db/rls.sql). */
export interface DbContext {
  tenantId: string;
  /** Signed-in staff user; null for system work (seed refresh, login checks). */
  userId?: string | null;
  /** The user's roles in this clinic. No roles → e.g. clinical notes are invisible. */
  roles?: readonly string[];
  /** Allowed branches; null/undefined = all branches of the clinic. */
  branchIds?: readonly string[] | null;
  /** Signed-in patient (patient page). Requires roles ["patient"]. */
  patientId?: string | null;
}

/**
 * Runs `fn` inside a transaction where Postgres knows the current clinic, user, roles
 * and allowed branches. Row-Level Security uses these to decide what is visible.
 *
 * `set_config(..., true)` is transaction-local: it disappears at COMMIT/ROLLBACK, so the
 * setting can never leak to another request that reuses the same pooled connection.
 * This is also why it works with Supabase's transaction pooler.
 *
 * Every query for clinic data MUST go through this helper. Without it, RLS returns no rows.
 */
export async function withTenant<T>(
  context: string | DbContext,
  fn: (tx: TenantTx) => Promise<T>,
): Promise<T> {
  const ctx: DbContext = typeof context === "string" ? { tenantId: context } : context;
  if (!UUID_RE.test(ctx.tenantId)) throw new Error("withTenant: tenantId must be a UUID");
  if (ctx.userId != null && !USER_RE.test(ctx.userId)) throw new Error("withTenant: bad userId");
  const roles = ctx.roles ?? [];
  if (!roles.every((r) => ROLE_RE.test(r))) throw new Error("withTenant: bad role");
  const branches = ctx.branchIds ?? null;
  if (ctx.patientId != null && !UUID_RE.test(ctx.patientId))
    throw new Error("withTenant: bad patientId");
  if ((ctx.patientId != null) !== roles.includes("patient")) {
    throw new Error("withTenant: patientId and the patient role go together");
  }
  if (branches && !branches.every((b) => UUID_RE.test(b))) {
    throw new Error("withTenant: branchIds must be UUIDs");
  }

  return getDb().transaction(async (tx) => {
    await tx.execute(sql`select
      set_config('app.tenant_id', ${ctx.tenantId}, true),
      set_config('app.user_id', ${ctx.userId ?? ""}, true),
      set_config('app.roles', ${roles.join(",")}, true),
      set_config('app.branch_ids', ${branches ? branches.join(",") : "*"}, true),
      set_config('app.patient_id', ${ctx.patientId ?? ""}, true)`);
    return fn(tx);
  });
}
