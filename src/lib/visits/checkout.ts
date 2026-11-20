/**
 * Reception's checkout of a posted visit: the invoice lines the doctor / nurse added (package
 * sessions at 0), what the patient paid and how, the clinic's own invoice number, the next
 * sessions of the treatment plan, and the patient's instructions (print / WhatsApp link).
 *
 * Money: the official invoice stays in the clinic's own (ZATCA) system — we record the amount,
 * method and that system's invoice number. One checkout per visit, never edited (database).
 */
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import {
  appointments,
  branches,
  packageSessionEvents,
  patients,
  services,
  tenantMembers,
  users,
  visitCheckouts,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { findFreeSlots, getAppointment } from "@/lib/booking/engine";
import { addDays, atRiyadh, riyadhDay } from "@/lib/booking/time";
import { VisitError, visitExtras } from "./visit";

export interface InvoiceLine {
  code: string;
  nameAr: string;
  nameEn: string;
  quantity: number;
  unitPriceHalalas: number;
  coveredByPackage: boolean;
}

/** Amount due: the lines a package didn't cover. */
export const dueOf = (lines: InvoiceLine[]) =>
  lines.reduce((s, l) => s + (l.coveredByPackage ? 0 : l.quantity * l.unitPriceHalalas), 0);

/**
 * The visit's invoice lines. Visits posted before invoice codes existed (or with none added)
 * get the booked service at its list price — 0 when a package session paid for it.
 */
async function invoiceLines(tx: TenantTx, appt: { id: string; serviceId: string }) {
  const { charges } = await visitExtras(tx, appt.id);
  if (charges.length) {
    return charges.map((c) => ({
      code: c.code,
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      quantity: c.quantity,
      unitPriceHalalas: c.unitPriceHalalas,
      coveredByPackage: c.coveredByPackage,
    }));
  }
  const [s] = await tx.select().from(services).where(eq(services.id, appt.serviceId));
  const [deduction] = await tx
    .select({ id: packageSessionEvents.id })
    .from(packageSessionEvents)
    .where(
      and(
        eq(packageSessionEvents.appointmentId, appt.id),
        eq(packageSessionEvents.kind, "deduction"),
      ),
    )
    .limit(1);
  return s
    ? [
        {
          code: s.code,
          nameAr: s.nameAr,
          nameEn: s.nameEn,
          quantity: 1,
          unitPriceHalalas: s.priceHalalas,
          coveredByPackage: !!deduction,
        },
      ]
    : [];
}

/** How many plan sessions are suggested at most (the rest can be booked later). */
const MAX_SUGGESTED = 6;

export interface PlanSuggestion {
  orderId: string;
  /** 1 = the first of the plan's sessions. */
  index: number;
  serviceId: string;
  /** The day the plan points to (Riyadh, YYYY-MM-DD). */
  targetDay: string;
  /** The first free time from that day (same doctor if possible), or null when none in a week. */
  slot: { day: string; time: string; practitionerId: string } | null;
  /** Already booked around that day (within 3 days). */
  bookedAppointmentId: string | null;
}

function riyadhTime(d: Date) {
  return new Date(d.getTime() + 3 * 3600_000).toISOString().slice(11, 16);
}

export async function checkoutData(tx: TenantTx, actor: Actor, appointmentId: string) {
  assertCan(actor.roles, "visits:checkout");
  const [row] = await tx
    .select({
      a: appointments,
      patient: patients,
      service: services,
      branch: branches,
      doctorName: users.name,
      doctorNameEn: users.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(appointments.id, appointmentId));
  if (!row) throw new VisitError("not_found");
  const a = row.a;
  const lines = await invoiceLines(tx, a);
  const { orders } = await visitExtras(tx, a.id);
  const [checkout] = await tx
    .select()
    .from(visitCheckouts)
    .where(eq(visitCheckouts.appointmentId, a.id));

  // The patient's next appointments (to see what's booked already).
  const upcoming = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      serviceId: appointments.serviceId,
      practitionerId: appointments.practitionerId,
      status: appointments.status,
    })
    .from(appointments)
    .where(
      and(
        eq(appointments.patientId, a.patientId),
        gt(appointments.startsAt, a.startsAt),
        inArray(appointments.status, ["pending", "booked", "confirmed"]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(12);

  // Treatment plan → the next sessions: every N weeks from this visit, first free time that week.
  const suggestions: PlanSuggestion[] = [];
  if (a.status === "completed") {
    const base = riyadhDay(a.startsAt);
    for (const o of orders) {
      if (o.kind !== "treatment" || !o.serviceId || !o.sessions || !o.intervalWeeks) continue;
      for (let k = 1; k <= Math.min(o.sessions, MAX_SUGGESTED); k++) {
        const targetDay = addDays(base, k * 7 * o.intervalWeeks);
        const target = atRiyadh(targetDay, "12:00").getTime();
        const booked = upcoming.find(
          (u) =>
            u.serviceId === o.serviceId &&
            Math.abs(u.startsAt.getTime() - target) <= 3.5 * 86400_000,
        );
        let slot: PlanSuggestion["slot"] = null;
        if (!booked) {
          const from = new Date(Math.max(atRiyadh(targetDay, "00:00").getTime(), Date.now()));
          const find = (practitionerId?: string) =>
            findFreeSlots(tx, {
              branchId: a.branchId,
              serviceId: o.serviceId!,
              practitionerId,
              from,
              days: 7,
              limit: 1,
            }).catch(() => []);
          const same = await find(a.practitionerId);
          const [s] = same.length ? same : await find();
          if (s) {
            slot = {
              day: riyadhDay(s.startsAt),
              time: riyadhTime(s.startsAt),
              practitionerId: s.practitionerId,
            };
          }
        }
        suggestions.push({
          orderId: o.id,
          index: k,
          serviceId: o.serviceId,
          targetDay,
          slot,
          bookedAppointmentId: booked?.id ?? null,
        });
      }
    }
  }

  return {
    appointment: a,
    patient: row.patient,
    service: row.service,
    branch: row.branch,
    doctor: { nameAr: row.doctorName, nameEn: row.doctorNameEn },
    lines,
    due: dueOf(lines),
    orders,
    checkout: checkout ?? null,
    upcoming,
    suggestions,
  };
}

export interface CheckoutInput {
  appointmentId: string;
  paidHalalas: number;
  method: "cash" | "card" | "transfer" | null;
  invoiceNumber?: string | null;
  note?: string | null;
}

/** Records the checkout (once). The amount due is worked out here, never taken from the screen. */
export async function checkOut(tx: TenantTx, actor: Actor, input: CheckoutInput) {
  assertCan(actor.roles, "visits:checkout");
  const appt = await getAppointment(tx, input.appointmentId, true); // row lock: one checkout
  if (appt.status !== "completed") throw new VisitError("not_completed");
  const [already] = await tx
    .select({ id: visitCheckouts.id })
    .from(visitCheckouts)
    .where(eq(visitCheckouts.appointmentId, appt.id));
  if (already) throw new VisitError("checked_out");
  const paid = Math.max(0, Math.round(input.paidHalalas));
  if (paid > 0 && !input.method) throw new VisitError("method_needed");
  const due = dueOf(await invoiceLines(tx, appt));
  const [row] = await tx
    .insert(visitCheckouts)
    .values({
      tenantId: actor.tenantId,
      appointmentId: appt.id,
      patientId: appt.patientId,
      dueHalalas: due,
      paidHalalas: paid,
      method: paid > 0 ? input.method : null,
      invoiceNumber: input.invoiceNumber?.trim() || null,
      note: input.note?.trim() || null,
      checkedOutByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.checkout",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { due, paid, method: row.method, invoiceNumber: row.invoiceNumber },
  });
  return row;
}

/**
 * What the patient's instruction sheet shows (print at checkout, or the WhatsApp care link):
 * first name, the visit, the doctor's orders and the next appointments. No notes, no diagnosis.
 * Callers decide who may see it (staff permission, or a valid signed link).
 */
export async function instructionsData(tx: TenantTx, appointmentId: string) {
  const [row] = await tx
    .select({
      a: appointments,
      patient: patients,
      service: services,
      branch: branches,
      doctorName: users.name,
      doctorNameEn: users.nameEn,
    })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(branches, eq(branches.id, appointments.branchId))
    .innerJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(eq(appointments.id, appointmentId));
  if (!row) return null;
  const { orders } = await visitExtras(tx, appointmentId);
  const next = await tx
    .select({
      id: appointments.id,
      startsAt: appointments.startsAt,
      serviceAr: services.nameAr,
      serviceEn: services.nameEn,
      doctorName: users.name,
      doctorNameEn: users.nameEn,
    })
    .from(appointments)
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .innerJoin(tenantMembers, eq(tenantMembers.id, appointments.practitionerId))
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(
      and(
        eq(appointments.patientId, row.a.patientId),
        gt(appointments.startsAt, row.a.startsAt),
        inArray(appointments.status, ["booked", "confirmed"]),
      ),
    )
    .orderBy(asc(appointments.startsAt))
    .limit(10);
  const serviceIds = [...new Set(orders.map((o) => o.serviceId).filter((x): x is string => !!x))];
  const planServices = serviceIds.length
    ? await tx
        .select({ id: services.id, nameAr: services.nameAr, nameEn: services.nameEn })
        .from(services)
        .where(inArray(services.id, serviceIds))
    : [];
  return {
    appointment: row.a,
    patient: {
      nameAr: row.patient.fullNameAr,
      nameEn: row.patient.fullNameEn,
      fileNumber: row.patient.fileNumber,
    },
    service: { nameAr: row.service.nameAr, nameEn: row.service.nameEn },
    branch: { nameAr: row.branch.nameAr, nameEn: row.branch.nameEn },
    doctor: { nameAr: row.doctorName, nameEn: row.doctorNameEn },
    medications: orders.filter((o) => o.kind === "medication"),
    plans: orders
      .filter((o) => o.kind === "treatment")
      .map((o) => ({ ...o, service: planServices.find((s) => s.id === o.serviceId) ?? null })),
    next,
  };
}
export type InstructionsData = NonNullable<Awaited<ReturnType<typeof instructionsData>>>;
