import "server-only";
/**
 * Reports → daily file for the clinic's invoicing / accounting system (one CSV per day):
 * - visit: each invoice code of a completed visit (from the visit screen), or its service when it
 *   has none — at the price of that day (0 when a package session paid for it)
 * - package_sale: each package sold that day, at its price
 * - package_payment: each package payment recorded that day (cash / card / transfer)
 * The clinic's invoicing system issues the official (ZATCA) invoice; this file only feeds it.
 * No clinical information: services and prices only.
 */
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import {
  appointments,
  branches,
  packagePayments,
  packageSessionEvents,
  patientPackages,
  patients,
  services,
  tenantMembers,
  users,
  visitCharges,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { dayRange, riyadhDay, riyadhTime } from "@/lib/booking/time";
import { toCsv } from "@/lib/export/clinic-export";

export const DAILY_COLUMNS = [
  "type",
  "date",
  "time",
  "reference",
  "branch",
  "file_number",
  "patient_ar",
  "patient_en",
  "phone",
  "id_number",
  "item_code",
  "item_ar",
  "item_en",
  "quantity",
  "doctor",
  "list_price_sar",
  "amount_sar",
  "paid_by",
];

const sar = (h: number) => (h / 100).toFixed(2);

export async function dailyInvoicingCsv(
  tx: TenantTx,
  actor: Actor,
  day: string,
  branchId: string | null,
) {
  assertCan(actor.roles, "invoicing:export");
  const [from, to] = dayRange(day);

  const visits = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      branch: branches.nameEn,
      fileNumber: patients.fileNumber,
      patientAr: patients.fullNameAr,
      patientEn: patients.fullNameEn,
      phone: patients.phone,
      idNumber: patients.idNumber,
      code: services.code,
      serviceAr: services.nameAr,
      serviceEn: services.nameEn,
      price: services.priceHalalas,
      doctor: users.name,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .leftJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
    .leftJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(
        eq(appointments.status, "completed"),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        branchId ? eq(appointments.branchId, branchId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
  const covered = new Map<string, string>();
  if (visits.length) {
    const ev = await tx
      .select({ appointmentId: packageSessionEvents.appointmentId, pkg: patientPackages.nameEn })
      .from(packageSessionEvents)
      .innerJoin(patientPackages, eq(patientPackages.id, packageSessionEvents.patientPackageId))
      .where(
        and(
          eq(packageSessionEvents.kind, "deduction"),
          inArray(
            packageSessionEvents.appointmentId,
            visits.map((v) => v.id),
          ),
        ),
      );
    for (const e of ev) if (e.appointmentId) covered.set(e.appointmentId, e.pkg);
  }

  // The visit's invoice codes (posted on the visit screen); a visit without any → its service.
  const lines = new Map<string, (typeof visitCharges.$inferSelect)[]>();
  if (visits.length) {
    const all = await tx
      .select()
      .from(visitCharges)
      .where(
        inArray(
          visitCharges.appointmentId,
          visits.map((v) => v.id),
        ),
      )
      .orderBy(asc(visitCharges.createdAt), asc(visitCharges.id));
    for (const c of all) lines.set(c.appointmentId, [...(lines.get(c.appointmentId) ?? []), c]);
  }

  const rows: (string | number | null)[][] = visits.flatMap((v) => {
    const pkg = covered.get(v.id);
    const who = [
      day,
      riyadhTime(v.startsAt),
      v.id.slice(0, 8),
      v.branch,
      v.fileNumber,
      v.patientAr,
      v.patientEn,
      v.phone,
      v.idNumber,
    ];
    const charged = lines.get(v.id);
    if (charged?.length) {
      return charged.map((c) => [
        "visit",
        ...who,
        c.code,
        c.nameAr,
        c.nameEn,
        c.quantity,
        v.doctor,
        sar(c.unitPriceHalalas),
        c.coveredByPackage ? "0.00" : sar(c.quantity * c.unitPriceHalalas),
        c.coveredByPackage ? `package: ${pkg ?? ""}`.trim() : "at_clinic",
      ]);
    }
    return [
      [
        "visit",
        ...who,
        v.code,
        v.serviceAr,
        v.serviceEn,
        1,
        v.doctor,
        sar(v.price),
        pkg ? "0.00" : sar(v.price),
        pkg ? `package: ${pkg}` : "at_clinic",
      ],
    ];
  });

  // Packages are sold to the clinic's patient, not at a branch: in the "all branches" file only.
  if (!branchId) {
    const sold = await tx
      .select({
        id: patientPackages.id,
        at: patientPackages.purchasedAt,
        fileNumber: patients.fileNumber,
        patientAr: patients.fullNameAr,
        patientEn: patients.fullNameEn,
        phone: patients.phone,
        idNumber: patients.idNumber,
        nameAr: patientPackages.nameAr,
        nameEn: patientPackages.nameEn,
        price: patientPackages.priceHalalas,
      })
      .from(patientPackages)
      .innerJoin(patients, eq(patients.id, patientPackages.patientId))
      .where(and(gte(patientPackages.purchasedAt, from), lt(patientPackages.purchasedAt, to)))
      .orderBy(asc(patientPackages.purchasedAt));
    for (const p of sold)
      rows.push([
        "package_sale",
        day,
        riyadhTime(p.at),
        p.id.slice(0, 8),
        null,
        p.fileNumber,
        p.patientAr,
        p.patientEn,
        p.phone,
        p.idNumber,
        "package",
        p.nameAr,
        p.nameEn,
        1,
        null,
        sar(p.price),
        sar(p.price),
        null,
      ]);

    const paid = await tx
      .select({
        id: packagePayments.id,
        packageId: patientPackages.id,
        at: packagePayments.paidAt,
        amount: packagePayments.amountHalalas,
        method: packagePayments.method,
        fileNumber: patients.fileNumber,
        patientAr: patients.fullNameAr,
        patientEn: patients.fullNameEn,
        phone: patients.phone,
        idNumber: patients.idNumber,
        nameAr: patientPackages.nameAr,
        nameEn: patientPackages.nameEn,
      })
      .from(packagePayments)
      .innerJoin(patientPackages, eq(patientPackages.id, packagePayments.patientPackageId))
      .innerJoin(patients, eq(patients.id, patientPackages.patientId))
      .where(and(gte(packagePayments.paidAt, from), lt(packagePayments.paidAt, to)))
      .orderBy(asc(packagePayments.paidAt));
    for (const p of paid)
      rows.push([
        "package_payment",
        day,
        riyadhTime(p.at),
        p.packageId.slice(0, 8),
        null,
        p.fileNumber,
        p.patientAr,
        p.patientEn,
        p.phone,
        p.idNumber,
        "package",
        p.nameAr,
        p.nameEn,
        1,
        null,
        null,
        sar(p.amount),
        p.method,
      ]);
  }
  return { csv: toCsv(DAILY_COLUMNS, rows), rows: rows.length, day: riyadhDay(from) };
}
