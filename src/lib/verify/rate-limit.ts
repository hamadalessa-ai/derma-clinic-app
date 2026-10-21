/**
 * Rate limits that hold across all server instances (Vercel runs many): every attempt is a row
 * in rate_limit_hits, counted inside a time window. A transaction-level advisory lock per bucket
 * makes "count, then add" safe when two requests arrive at the same moment.
 */
import { and, count, eq, gt, sql } from "drizzle-orm";
import { rateLimitHits } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

export interface Limit {
  bucket: string;
  limit: number;
  windowMinutes: number;
}

/** True (and the attempt is recorded) when every limit still has room; false when any is full. */
export async function takeRateLimit(tx: TenantTx, limits: Limit[]): Promise<boolean> {
  const buckets = [...new Set(limits.map((l) => l.bucket))].sort();
  for (const b of buckets) {
    await tx.execute(
      sql`select pg_advisory_xact_lock(hashtextextended(public.app_current_tenant()::text || ':' || ${b}, 0))`,
    );
  }
  for (const l of limits) {
    const [row] = await tx
      .select({ n: count() })
      .from(rateLimitHits)
      .where(
        and(
          eq(rateLimitHits.bucket, l.bucket),
          gt(rateLimitHits.createdAt, sql`now() - make_interval(mins => ${l.windowMinutes})`),
        ),
      );
    if (row.n >= l.limit) return false;
  }
  await tx
    .insert(rateLimitHits)
    .values(buckets.map((bucket) => ({ tenantId: sql`public.app_current_tenant()`, bucket })));
  return true;
}
