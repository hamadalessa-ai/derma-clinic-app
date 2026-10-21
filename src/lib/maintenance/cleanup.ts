/**
 * Daily housekeeping (Vercel Cron → /api/cron/daily): removes used-up security rows per clinic.
 * Nothing medical is touched; signed consents, payments and audit logs are never deleted.
 */
import { and, isNotNull, lt, or, sql } from "drizzle-orm";
import { getDb } from "@/db/client";
import { patientSessions, rateLimitHits, tenants, verificationCodes } from "@/db/schema";
import { withTenant } from "@/db/tenant";

export async function dailyCleanup() {
  const clinics = await getDb().select({ id: tenants.id, slug: tenants.slug }).from(tenants);
  const out: Record<string, { codes: number; rateLimits: number; sessions: number }> = {};
  for (const c of clinics) {
    out[c.slug] = await withTenant(c.id, async (tx) => {
      const codes = await tx
        .delete(verificationCodes)
        .where(lt(verificationCodes.expiresAt, sql`now() - interval '1 day'`))
        .returning({ id: verificationCodes.id });
      const rateLimits = await tx
        .delete(rateLimitHits)
        .where(lt(rateLimitHits.createdAt, sql`now() - interval '2 days'`))
        .returning({ id: rateLimitHits.id });
      const sessions = await tx
        .delete(patientSessions)
        .where(
          or(
            lt(patientSessions.expiresAt, sql`now() - interval '1 day'`),
            and(
              isNotNull(patientSessions.revokedAt),
              lt(patientSessions.revokedAt, sql`now() - interval '1 day'`),
            ),
          ),
        )
        .returning({ id: patientSessions.id });
      return { codes: codes.length, rateLimits: rateLimits.length, sessions: sessions.length };
    });
  }
  return out;
}
