import "server-only";
/**
 * Reports for the clinic owner (clinic admin): one month, all branches or one.
 * Money here is an estimate from list prices — most patients pay at the clinic's own till, which
 * stays the official record. Package payments are the ones recorded in the app.
 * Counts only: no patient names, so nothing here is medical.
 */
import { and, eq, gte, inArray, lt, sql } from "drizzle-orm";
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
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { addDays, atRiyadh, riyadhDay } from "@/lib/booking/time";

export function isMonth(v: unknown): v is string {
  return typeof v === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(v);
}

/** "2026-11" → first day, the first day of the next month, and the month's days (Riyadh time). */
export function monthDays(month: string) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const first = `${month}-01`;
  const next = m === 12 ? `${y + 1}-01-01` : `${y}-${String(m + 1).padStart(2, "0")}-01`;
  const days: string[] = [];
  for (let d = first; d < next; d = addDays(d, 1)) days.push(d);
  return { from: atRiyadh(first, "00:00"), to: atRiyadh(next, "00:00"), days };
}

export function shiftMonth(month: string, n: number) {
  const [y, m] = month.split("-").map(Number) as [number, number];
  const i = y * 12 + (m - 1) + n;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}

export const thisMonth = (now = new Date()) => riyadhDay(now).slice(0, 7);

export interface Totals {
  bookings: number; // everything that started in the month, except cancelled and still-pending
  completed: number;
  noShow: number;
  cancelled: number;
  /** no-shows ÷ (completed + no-shows), 0–100. */
  noShowRate: number;
  bySource: { reception: number; online: number; whatsapp: number };
  /** Completed visits not covered by a package, at list price (halalas). */
  visitValue: number;
  /** Completed visits that used a package session. */
  packageVisits: number;
  packagesSold: number;
  packagesValue: number;
  packagePayments: number;
  newPatients: number;
}

export interface OwnerReport {
  month: string;
  branchId: string | null;
  totals: Totals;
  previous: Totals;
  byDoctor: {
    id: string;
    name: string;
    nameEn: string | null;
    bookings: number;
    completed: number;
    noShow: number;
    value: number;
  }[];
  byService: { id: string; nameAr: string; nameEn: string; completed: number; value: number }[];
  byBranch: { id: string; nameAr: string; nameEn: string; bookings: number; completed: number }[];
  byDay: { day: string; bookings: number }[];
}

type Visit = {
  id: string;
  status: string;
  source: "reception" | "online" | "whatsapp";
  startsAt: Date;
  branchId: string;
  serviceId: string;
  practitionerId: string;
  price: number;
};

async function visits(tx: TenantTx, from: Date, to: Date, branchId: string | null) {
  const rows: Visit[] = await tx
    .select({
      id: appointments.id,
      status: appointments.status,
      source: appointments.source,
      startsAt: appointments.startsAt,
      branchId: appointments.branchId,
      serviceId: appointments.serviceId,
      practitionerId: appointments.practitionerId,
      price: services.priceHalalas,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .where(
      and(
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        branchId ? eq(appointments.branchId, branchId) : undefined,
      ),
    );
  const ids = rows.filter((r) => r.status === "completed").map((r) => r.id);
  const fromPackage = new Set<string>();
  for (let i = 0; i < ids.length; i += 1000) {
    const got = await tx
      .select({ id: packageSessionEvents.appointmentId })
      .from(packageSessionEvents)
      .where(
        and(
          eq(packageSessionEvents.kind, "deduction"),
          inArray(packageSessionEvents.appointmentId, ids.slice(i, i + 1000)),
        ),
      );
    for (const g of got) if (g.id) fromPackage.add(g.id);
  }
  return { rows, fromPackage };
}

const counted = (v: Visit) => v.status !== "cancelled" && v.status !== "pending";
const paidAtVisit = (v: Visit, fromPackage: Set<string>) =>
  v.status === "completed" && !fromPackage.has(v.id) ? v.price : 0;

async function totals(tx: TenantTx, month: string, branchId: string | null) {
  const { from, to } = monthDays(month);
  const { rows, fromPackage } = await visits(tx, from, to, branchId);
  const completed = rows.filter((r) => r.status === "completed").length;
  const noShow = rows.filter((r) => r.status === "no_show").length;
  const bySource = { reception: 0, online: 0, whatsapp: 0 };
  for (const r of rows) if (counted(r)) bySource[r.source]++;

  // Packages and new patients belong to the clinic, not a branch: shown for "all branches" only.
  let packagesSold = 0;
  let packagesValue = 0;
  let paid = 0;
  let newPatients = 0;
  if (!branchId) {
    const [p] = await tx
      .select({
        n: sql<number>`count(*)::int`,
        v: sql<number>`coalesce(sum(${patientPackages.priceHalalas}), 0)::bigint`,
      })
      .from(patientPackages)
      .where(and(gte(patientPackages.purchasedAt, from), lt(patientPackages.purchasedAt, to)));
    const [pay] = await tx
      .select({ v: sql<number>`coalesce(sum(${packagePayments.amountHalalas}), 0)::bigint` })
      .from(packagePayments)
      .where(and(gte(packagePayments.paidAt, from), lt(packagePayments.paidAt, to)));
    const [np] = await tx
      .select({ n: sql<number>`count(*)::int` })
      .from(patients)
      .where(and(gte(patients.createdAt, from), lt(patients.createdAt, to)));
    packagesSold = Number(p?.n ?? 0);
    packagesValue = Number(p?.v ?? 0);
    paid = Number(pay?.v ?? 0);
    newPatients = Number(np?.n ?? 0);
  }

  const t: Totals = {
    bookings: rows.filter(counted).length,
    completed,
    noShow,
    cancelled: rows.filter((r) => r.status === "cancelled").length,
    noShowRate: completed + noShow ? Math.round((noShow / (completed + noShow)) * 100) : 0,
    bySource,
    visitValue: rows.reduce((s, r) => s + paidAtVisit(r, fromPackage), 0),
    packageVisits: rows.filter((r) => r.status === "completed" && fromPackage.has(r.id)).length,
    packagesSold,
    packagesValue,
    packagePayments: paid,
    newPatients,
  };
  return { t, rows, fromPackage };
}

export async function ownerReport(
  tx: TenantTx,
  actor: Actor,
  month: string,
  branchId: string | null,
): Promise<OwnerReport> {
  assertCan(actor.roles, "reports:view");
  const now = await totals(tx, month, branchId);
  const before = await totals(tx, shiftMonth(month, -1), branchId);
  const { rows, fromPackage } = now;

  const doctorIds = [...new Set(rows.map((r) => r.practitionerId))];
  const names = doctorIds.length
    ? await tx
        .select({ id: tenantMembers.id, name: users.name, nameEn: users.nameEn })
        .from(tenantMembers)
        .innerJoin(users, eq(users.id, tenantMembers.userId))
        .where(inArray(tenantMembers.id, doctorIds))
    : [];
  const nameOf = new Map(names.map((n) => [n.id, n]));
  const byDoctor = doctorIds
    .map((id) => {
      const mine = rows.filter((r) => r.practitionerId === id);
      return {
        id,
        name: nameOf.get(id)?.name ?? "—",
        nameEn: nameOf.get(id)?.nameEn ?? null,
        bookings: mine.filter(counted).length,
        completed: mine.filter((r) => r.status === "completed").length,
        noShow: mine.filter((r) => r.status === "no_show").length,
        value: mine.reduce((s, r) => s + paidAtVisit(r, fromPackage), 0),
      };
    })
    .filter((d) => d.bookings > 0)
    .sort((a, b) => b.completed - a.completed || b.bookings - a.bookings);

  const serviceRows = await tx
    .select({ id: services.id, nameAr: services.nameAr, nameEn: services.nameEn })
    .from(services);
  const byService = serviceRows
    .map((s) => {
      const done = rows.filter((r) => r.serviceId === s.id && r.status === "completed");
      return {
        ...s,
        completed: done.length,
        value: done.reduce((sum, r) => sum + paidAtVisit(r, fromPackage), 0),
      };
    })
    .filter((s) => s.completed > 0)
    .sort((a, b) => b.completed - a.completed || b.value - a.value);

  const branchRows = await tx
    .select({ id: branches.id, nameAr: branches.nameAr, nameEn: branches.nameEn })
    .from(branches);
  const byBranch = branchRows
    .map((b) => {
      const mine = rows.filter((r) => r.branchId === b.id);
      return {
        ...b,
        bookings: mine.filter(counted).length,
        completed: mine.filter((r) => r.status === "completed").length,
      };
    })
    .filter((b) => b.bookings > 0);

  const perDay = new Map<string, number>();
  for (const r of rows)
    if (counted(r)) perDay.set(riyadhDay(r.startsAt), (perDay.get(riyadhDay(r.startsAt)) ?? 0) + 1);
  const byDay = monthDays(month).days.map((day) => ({ day, bookings: perDay.get(day) ?? 0 }));

  return {
    month,
    branchId,
    totals: now.t,
    previous: before.t,
    byDoctor,
    byService,
    byBranch,
    byDay,
  };
}

/** Branches the filter offers. */
export async function reportBranches(tx: TenantTx) {
  return tx
    .select({ id: branches.id, nameAr: branches.nameAr, nameEn: branches.nameEn })
    .from(branches);
}
