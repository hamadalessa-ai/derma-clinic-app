import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { patientMedicalFlags, patients } from "@/db/schema";

export type Patient = typeof patients.$inferSelect;

export interface PatientAlerts {
  allergies: string[];
  contraindications: string[];
  medications: string[];
}

const EMPTY: PatientAlerts = { allergies: [], contraindications: [], medications: [] };

export function hasWarning(a: PatientAlerts | undefined) {
  return !!a && (a.allergies.length > 0 || a.contraindications.length > 0);
}

/** Medical alerts for many patients at once (for badges in lists and calendars). */
export async function getPatientAlerts(
  tx: TenantTx,
  patientIds: string[],
): Promise<Map<string, PatientAlerts>> {
  const map = new Map<string, PatientAlerts>();
  if (patientIds.length === 0) return map;
  const rows = await tx
    .select()
    .from(patientMedicalFlags)
    .where(inArray(patientMedicalFlags.patientId, [...new Set(patientIds)]));
  for (const r of rows) {
    const a = map.get(r.patientId) ?? { allergies: [], contraindications: [], medications: [] };
    if (r.kind === "allergy") a.allergies.push(r.label);
    else if (r.kind === "contraindication") a.contraindications.push(r.label);
    else a.medications.push(r.label);
    map.set(r.patientId, a);
  }
  return map;
}

export function alertsFor(map: Map<string, PatientAlerts>, id: string): PatientAlerts {
  return map.get(id) ?? EMPTY;
}

const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Turns "٠٥٠٠ ٠١٠ ٠٠٣" or "+966 500010003" into "0500010003". */
export function normalizePhoneQuery(q: string): string {
  let digits = q.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("966")) digits = `0${digits.slice(3)}`;
  return digits;
}

/**
 * Search by name (Arabic or English), phone, file number or ID number.
 * Arabic spelling variants match: "احمد" finds "أحمد", "فاطمه" finds "فاطمة".
 */
export async function searchPatients(tx: TenantTx, query: string, limit = 25): Promise<Patient[]> {
  const q = query.trim().slice(0, 100);
  if (!q) {
    return tx.select().from(patients).orderBy(asc(patients.fileNumber)).limit(limit);
  }
  const digits = normalizePhoneQuery(q);
  const nameMatch = sql`public.normalize_search(${patients.fullNameAr} || ' ' || coalesce(${patients.fullNameEn}, '') || ' ' || ${patients.fileNumber}) like '%' || public.normalize_search(${q}) || '%'`;
  // Only treat the query as a phone/ID number when it has no letters (so "D-0012" is a file number).
  const looksNumeric = !/[A-Za-z\u0600-\u065F\u066E-\u06FF]/.test(q);
  const digitMatch =
    looksNumeric && digits.length >= 3
      ? or(
          sql`${patients.phone} like ${"%" + digits + "%"}`,
          sql`coalesce(${patients.idNumber}, '') like ${"%" + digits + "%"}`,
        )
      : undefined;
  return tx
    .select()
    .from(patients)
    .where(digitMatch ? or(nameMatch, digitMatch) : nameMatch)
    .orderBy(asc(patients.fileNumber))
    .limit(limit);
}

export async function getPatient(tx: TenantTx, id: string) {
  const [p] = await tx.select().from(patients).where(eq(patients.id, id)).limit(1);
  return p ?? null;
}

/** The guardian and the people this patient is guardian of. */
export async function getFamily(tx: TenantTx, patient: Patient) {
  const ids = patient.guardianId ? [patient.guardianId] : [];
  const rows = await tx
    .select()
    .from(patients)
    .where(
      and(
        or(
          eq(patients.guardianId, patient.id),
          ids.length ? inArray(patients.id, ids) : sql`false`,
          patient.guardianId ? eq(patients.guardianId, patient.guardianId) : sql`false`,
        ),
        sql`${patients.id} <> ${patient.id}`,
      ),
    )
    .orderBy(asc(patients.fileNumber));
  return {
    guardian: rows.find((r) => r.id === patient.guardianId) ?? null,
    dependants: rows.filter((r) => r.guardianId === patient.id),
    siblings: patient.guardianId ? rows.filter((r) => r.guardianId === patient.guardianId) : [],
  };
}
