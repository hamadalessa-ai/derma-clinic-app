import "server-only";
/**
 * Rate limits that hold across ALL clinics and all server instances (per-clinic limits live in
 * src/lib/verify/rate-limit.ts). Used for staff sign-in and, per IP, for mobile code requests, so
 * an attacker can't multiply the allowance by trying one clinic address after another.
 * Buckets are stored as SHA-256 hashes: no email, mobile or IP address is kept in clear.
 */
import { createHash } from "node:crypto";
import { and, count, eq, gt, lt, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { globalRateHits } from "@/db/schema";

export interface GlobalLimit {
  /** Plain key, e.g. "login:email:sara@clinic.sa" — hashed before it is stored. */
  key: string;
  limit: number;
  windowMinutes: number;
}

export const bucketOf = (key: string) => createHash("sha256").update(key).digest("hex");

/** True (and the attempt is recorded) when every limit still has room; false when any is full. */
export async function takeGlobalLimit(limits: GlobalLimit[]): Promise<boolean> {
  return getDb().transaction(async (tx) => {
    const hashed = limits.map((l) => ({ ...l, bucket: bucketOf(l.key) }));
    for (const b of [...new Set(hashed.map((l) => l.bucket))].sort()) {
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${"g:" + b}, 0))`);
    }
    for (const l of hashed) {
      const [row] = await tx
        .select({ n: count() })
        .from(globalRateHits)
        .where(
          and(
            eq(globalRateHits.bucket, l.bucket),
            gt(globalRateHits.createdAt, sql`now() - make_interval(mins => ${l.windowMinutes})`),
          ),
        );
      if ((row?.n ?? 0) >= l.limit) return false;
    }
    await tx
      .insert(globalRateHits)
      .values([...new Set(hashed.map((l) => l.bucket))].map((bucket) => ({ bucket })));
    return true;
  });
}

/** How many attempts a key made in the window (without recording one). */
export async function globalHits(key: string, windowMinutes: number): Promise<number> {
  const [row] = await getDb()
    .select({ n: count() })
    .from(globalRateHits)
    .where(
      and(
        eq(globalRateHits.bucket, bucketOf(key)),
        gt(globalRateHits.createdAt, sql`now() - make_interval(mins => ${windowMinutes})`),
      ),
    );
  return row?.n ?? 0;
}

/** Daily housekeeping: counters older than two days are no longer needed. */
export async function purgeGlobalLimits(): Promise<number> {
  const gone = await getDb()
    .delete(globalRateHits)
    .where(lt(globalRateHits.createdAt, sql`now() - interval '2 days'`))
    .returning({ id: globalRateHits.id });
  return gone.length;
}
