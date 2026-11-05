import "server-only";
/**
 * Who is booking, as far as this browser has proven: a verified-mobile pass (booking step 1) or
 * the signed-in patient (patient page). Used by the booking page and its actions.
 */
import { cookies } from "next/headers";
import { asc, eq, sql } from "drizzle-orm";
import { patients } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import { PATIENT_COOKIE, patientForToken } from "@/lib/portal/session";
import { BOOKING_PASS_COOKIE, checkPhonePass } from "./pass";

/** The mobile already verified in this browser: booking pass, or the signed-in patient's own. */
export async function verifiedPhone(tenantId: string): Promise<string | null> {
  const jar = await cookies();
  const pass = checkPhonePass(tenantId, jar.get(BOOKING_PASS_COOKIE)?.value);
  if (pass) return pass;
  const session = await patientForToken(tenantId, jar.get(PATIENT_COOKIE)?.value);
  if (!session) return null;
  const [p] = await withTenant(tenantId, (tx) =>
    tx.select({ phone: patients.phone }).from(patients).where(eq(patients.id, session.patientId)),
  );
  return p?.phone ?? null;
}

/** The adult on file with this mobile (a family may share one number), for pre-filling. */
export async function adultByPhone(tx: TenantTx, phone: string) {
  const [p] = await tx
    .select({ fullName: patients.fullNameAr, gender: patients.gender })
    .from(patients)
    .where(eq(patients.phone, phone))
    .orderBy(sql`${patients.guardianId} is not null`, asc(patients.createdAt))
    .limit(1);
  return p ?? null;
}


/** For the booking page: who is already verified in this browser (null = start with the mobile). */
export async function bookingIdentity(tenantId: string) {
  const phone = await verifiedPhone(tenantId);
  if (!phone) return null;
  const known = await withTenant(tenantId, (tx) => adultByPhone(tx, phone));
  return { phone, known };
}
