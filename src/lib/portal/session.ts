/**
 * Patient sessions for the patient page (/my). Separate from staff logins:
 *  - a random token in an httpOnly cookie; only its SHA-256 is stored (patient_sessions),
 *  - valid 30 minutes from sign-in, revocable (sign out),
 *  - every read for the patient runs with role "patient" + app.patient_id, so the DATABASE limits
 *    it to their own and their family's rows (db/rls.sql, patient walls).
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { patientSessions } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";

export const PATIENT_COOKIE = "patient_session";
export const PATIENT_SESSION_MINUTES = 30;

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Creates a session row; returns the token for the cookie (never stored). */
export async function createPatientSession(
  tx: TenantTx,
  input: { tenantId: string; patientId: string; ip: string | null },
): Promise<{ token: string; expiresAt: Date }> {
  const token = randomBytes(32).toString("base64url");
  const [row] = await tx
    .insert(patientSessions)
    .values({
      tenantId: input.tenantId,
      patientId: input.patientId,
      tokenHash: hashToken(token),
      expiresAt: sql`now() + make_interval(mins => ${PATIENT_SESSION_MINUTES})`,
      ip: input.ip,
    })
    .returning({ expiresAt: patientSessions.expiresAt });
  return { token, expiresAt: row.expiresAt };
}

/** The patient for a token in this clinic, or null (unknown, expired, revoked, other clinic). */
export async function patientForToken(tenantId: string, token: string | undefined | null) {
  if (!token || token.length < 20 || token.length > 100) return null;
  const [row] = await withTenant(tenantId, (tx) =>
    tx
      .select({ patientId: patientSessions.patientId, expiresAt: patientSessions.expiresAt })
      .from(patientSessions)
      .where(
        and(
          eq(patientSessions.tokenHash, hashToken(token)),
          isNull(patientSessions.revokedAt),
          gt(patientSessions.expiresAt, sql`now()`),
        ),
      )
      .limit(1),
  );
  return row ?? null;
}

export async function revokePatientSession(tenantId: string, token: string | undefined | null) {
  if (!token) return;
  await withTenant(tenantId, (tx) =>
    tx
      .update(patientSessions)
      .set({ revokedAt: sql`now()` })
      .where(eq(patientSessions.tokenHash, hashToken(token))),
  );
}

/** Database context for reading as the signed-in patient. */
export function patientDbContext(tenantId: string, patientId: string) {
  return { tenantId, roles: ["patient"] as const, patientId };
}
