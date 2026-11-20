/**
 * The front desk's fast lane: find a patient by mobile / name / file number and see at once
 * whether they have a visit today; a walk-in is booked and checked in in one step.
 * Booking and check-in go through the usual engine and check-in flow (consent, package).
 */
import { and, asc, gte, inArray, lt } from "drizzle-orm";
import { appointments } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { bookAppointment } from "@/lib/booking/engine";
import { dayRange, riyadhDay } from "@/lib/booking/time";
import { searchPatients } from "@/lib/patients/queries";
import { checkIn } from "@/lib/visits/check-in";

export interface DeskHit {
  id: string;
  fileNumber: string;
  nameAr: string;
  nameEn: string | null;
  phone: string;
  /** Today's visit (the first one still to come, else the latest), if any. */
  today: { id: string; startsAt: string; status: string; branchId: string } | null;
}

export async function deskSearch(
  tx: TenantTx,
  actor: Actor,
  query: string,
  now = new Date(),
): Promise<DeskHit[]> {
  assertCan(actor.roles, "appointments:manage");
  const rows = await searchPatients(tx, query, 8);
  if (!rows.length) return [];
  const [from, to] = dayRange(riyadhDay(now));
  const todays = await tx
    .select({
      id: appointments.id,
      patientId: appointments.patientId,
      startsAt: appointments.startsAt,
      status: appointments.status,
      branchId: appointments.branchId,
    })
    .from(appointments)
    .where(
      and(
        inArray(
          appointments.patientId,
          rows.map((r) => r.id),
        ),
        gte(appointments.startsAt, from),
        lt(appointments.startsAt, to),
        inArray(appointments.status, ["booked", "confirmed", "arrived", "in_session", "completed"]),
      ),
    )
    .orderBy(asc(appointments.startsAt));
  const OPEN = ["booked", "confirmed", "arrived", "in_session"];
  return rows.map((p) => {
    const mine = todays.filter((a) => a.patientId === p.id);
    const pick = mine.find((a) => OPEN.includes(a.status)) ?? mine[mine.length - 1];
    return {
      id: p.id,
      fileNumber: p.fileNumber,
      nameAr: p.fullNameAr,
      nameEn: p.fullNameEn,
      phone: p.phone,
      today: pick
        ? {
            id: pick.id,
            startsAt: pick.startsAt.toISOString(),
            status: pick.status,
            branchId: pick.branchId,
          }
        : null,
    };
  });
}

/**
 * Walk-in: book the chosen free time and check the patient in, in ONE transaction. When the
 * service needs a consent first, the booking stays and the answer says so (the desk opens the
 * signature sheet, then checks in as usual).
 */
export async function walkIn(
  tx: TenantTx,
  actor: Actor,
  input: {
    branchId: string;
    patientId: string;
    serviceId: string;
    practitionerId: string;
    startsAt: Date;
  },
) {
  assertCan(actor.roles, "appointments:manage");
  const appt = await bookAppointment(tx, actor, { ...input, receptionNote: null });
  const result = await checkIn(tx, actor, appt.id);
  return { appointmentId: appt.id, result };
}
