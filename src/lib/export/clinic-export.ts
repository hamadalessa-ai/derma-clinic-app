import "server-only";
/**
 * Settings → Download clinic data: the clinic's own records as CSV files (opens in Excel), for
 * the clinic admin — any time, and especially when a clinic leaves the platform. Clinical notes
 * are NOT in here (admins can't read notes; doctors keep access to them in the app).
 */
import { asc, eq } from "drizzle-orm";
import {
  appointments,
  branches,
  patientPackages,
  patients,
  services,
  tenantMembers,
  users,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";

export const EXPORT_KINDS = ["patients", "appointments", "packages"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

type Cell = string | number | boolean | Date | null | undefined;

/** One CSV text (with a BOM so Excel shows Arabic correctly). */
export function toCsv(header: string[], rows: Cell[][]) {
  const cell = (v: Cell) => {
    if (v === null || v === undefined) return "";
    const s = v instanceof Date ? v.toISOString() : String(v);
    // Quote everything that needs it; neutralise spreadsheet formulas (=, +, -, @ at the start).
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
  };
  return "﻿" + [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

export async function exportCsv(tx: TenantTx, kind: ExportKind): Promise<string> {
  if (kind === "patients") {
    const rows = await tx.select().from(patients).orderBy(asc(patients.fileNumber));
    return toCsv(
      [
        "file_number",
        "name_ar",
        "name_en",
        "phone",
        "gender",
        "date_of_birth",
        "id_type",
        "id_number",
        "email",
        "created_at",
      ],
      rows.map((p) => [
        p.fileNumber,
        p.fullNameAr,
        p.fullNameEn,
        p.phone,
        p.gender,
        p.dateOfBirth,
        p.idType,
        p.idNumber,
        p.email,
        p.createdAt,
      ]),
    );
  }
  if (kind === "appointments") {
    const rows = await tx
      .select({
        startsAt: appointments.startsAt,
        endsAt: appointments.endsAt,
        status: appointments.status,
        source: appointments.source,
        fileNumber: patients.fileNumber,
        patientAr: patients.fullNameAr,
        patientEn: patients.fullNameEn,
        serviceEn: services.nameEn,
        doctor: users.name,
        branchEn: branches.nameEn,
      })
      .from(appointments)
      .leftJoin(patients, eq(patients.id, appointments.patientId))
      .leftJoin(services, eq(services.id, appointments.serviceId))
      .leftJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
      .leftJoin(users, eq(users.id, tenantMembers.userId))
      .leftJoin(branches, eq(branches.id, appointments.branchId))
      .orderBy(asc(appointments.startsAt));
    return toCsv(
      [
        "starts_at",
        "ends_at",
        "status",
        "source",
        "file_number",
        "patient_ar",
        "patient_en",
        "service",
        "doctor",
        "branch",
      ],
      rows.map((r) => [
        r.startsAt,
        r.endsAt,
        r.status,
        r.source,
        r.fileNumber,
        r.patientAr,
        r.patientEn,
        r.serviceEn,
        r.doctor,
        r.branchEn,
      ]),
    );
  }
  const rows = await tx
    .select({
      fileNumber: patients.fileNumber,
      patientAr: patients.fullNameAr,
      nameAr: patientPackages.nameAr,
      nameEn: patientPackages.nameEn,
      total: patientPackages.sessionsTotal,
      used: patientPackages.sessionsUsed,
      price: patientPackages.priceHalalas,
      purchasedAt: patientPackages.purchasedAt,
      expiresAt: patientPackages.expiresAt,
    })
    .from(patientPackages)
    .leftJoin(patients, eq(patients.id, patientPackages.patientId))
    .orderBy(asc(patientPackages.purchasedAt));
  return toCsv(
    [
      "file_number",
      "patient_ar",
      "package_ar",
      "package_en",
      "sessions_total",
      "sessions_used",
      "price_sar",
      "purchased_at",
      "expires_at",
    ],
    rows.map((r) => [
      r.fileNumber,
      r.patientAr,
      r.nameAr,
      r.nameEn,
      r.total,
      r.used,
      r.price === null ? null : (r.price / 100).toFixed(2),
      r.purchasedAt,
      r.expiresAt,
    ]),
  );
}
