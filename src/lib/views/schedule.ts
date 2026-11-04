/**
 * What the calendar and My Day need, in one load, already shaped for the screen:
 * appointments with patient, medical alerts, package balance; blocked time; doctors with
 * their hours; rooms; services. Everything runs inside withActor (RLS applies).
 */
import { and, asc, eq, gte, inArray, isNull, lt, or } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  appointments,
  branchHolidays,
  devices,
  messages,
  patients,
  rescheduleRequests,
  rooms,
  services,
  tenantMembers,
  timeBlocks,
  users,
} from "@/db/schema";
import { consentStatusFor } from "@/lib/consents/consents";
import { reasonView, type ConsentReasonView } from "@/lib/consents/rules";
import { getPatientAlerts, type PatientAlerts } from "@/lib/patients/queries";
import { balanceFor, packagesForPatients } from "@/lib/packages/packages";
import type { AppointmentStatus } from "@/lib/booking/status";
import { clockShiftsOn, loadHourRows, minutesView } from "@/lib/booking/hours";

export interface ApptView {
  id: string;
  branchId: string;
  startsAt: string;
  endsAt: string;
  blockedUntil: string;
  status: AppointmentStatus;
  /** Where the booking came from: reception, online (/book) or WhatsApp. */
  source: "reception" | "online" | "whatsapp";
  /** Patient created online, details still to complete at reception. */
  needsCompletion: boolean;
  practitionerId: string;
  roomId: string;
  deviceNameAr: string | null;
  deviceNameEn: string | null;
  serviceId: string;
  serviceNameAr: string;
  serviceNameEn: string;
  /** A video consultation (joined from /visits/<id>/video). */
  isVirtual: boolean;
  patient: { id: string; nameAr: string; nameEn: string | null; fileNumber: string; phone: string };
  alerts: PatientAlerts;
  balance: { remaining: number; total: number } | null;
  note: string | null;
  pendingRequest: { proposedStartsAt: string } | null;
  /** The consent this service needs (current version), and whether it's signed already. */
  consent: { signed: boolean; viaPatientPage: boolean; reason: ConsentReasonView } | null;
  /** WhatsApp messages sent about this appointment (type, delivery status, error). */
  whatsapp: { kind: string; status: string; errorCode: string | null; createdAt: string }[];
}

export interface BlockView {
  id: string;
  memberId: string | null;
  roomId: string | null;
  startsAt: string;
  endsAt: string;
  reason: string | null;
}

export interface DoctorView {
  id: string;
  userId: string;
  nameAr: string;
  nameEn: string | null;
  /** day ("2026-11-05") → working hours at this branch, in minutes since midnight. */
  hours: Record<string, DayHours | null>;
}

export interface DayHours {
  start: number;
  end: number;
  /** Gaps between shifts. */
  breaks: { start: number; end: number }[];
}

/** The branch's doctors, with their working hours on the given days (weekly pattern + changes). */
export async function loadDoctors(
  tx: TenantTx,
  branchId: string,
  days: string[] = [],
): Promise<DoctorView[]> {
  const rows = await tx
    .select({ member: tenantMembers, user: users })
    .from(tenantMembers)
    .innerJoin(users, eq(users.id, tenantMembers.userId))
    .where(or(isNull(tenantMembers.branchId), eq(tenantMembers.branchId, branchId)))
    .orderBy(asc(tenantMembers.createdAt));
  const docs = rows.filter((r) => r.member.roles.includes("practitioner"));
  const hourRows = await loadHourRows(
    tx,
    docs.map((d) => d.member.id),
    days,
  );
  const closed = days.length
    ? await tx
        .select({ day: branchHolidays.day })
        .from(branchHolidays)
        .where(
          and(
            inArray(branchHolidays.day, days),
            or(isNull(branchHolidays.branchId), eq(branchHolidays.branchId, branchId)),
          ),
        )
    : [];
  return docs.map(({ member, user }) => ({
    id: member.id,
    userId: user.id,
    nameAr: user.name,
    nameEn: user.nameEn,
    hours: Object.fromEntries(
      days.map((d) => [
        d,
        closed.some((c) => String(c.day) === d)
          ? null
          : minutesView(
              clockShiftsOn(member.id, d, hourRows.weekly, hourRows.exceptions),
              branchId,
            ),
      ]),
    ),
  }));
}

export async function loadRooms(tx: TenantTx, branchId: string) {
  return tx.select().from(rooms).where(eq(rooms.branchId, branchId)).orderBy(asc(rooms.createdAt));
}

export async function loadServices(tx: TenantTx) {
  return tx
    .select()
    .from(services)
    .where(eq(services.isActive, true))
    .orderBy(asc(services.sortOrder));
}

export async function loadAppointments(
  tx: TenantTx,
  opts: { branchId?: string; from: Date; to: Date; practitionerId?: string; patientId?: string },
): Promise<ApptView[]> {
  const rows = await tx
    .select({ a: appointments, p: patients, s: services, d: devices })
    .from(appointments)
    .innerJoin(patients, eq(patients.id, appointments.patientId))
    .innerJoin(services, eq(services.id, appointments.serviceId))
    .leftJoin(devices, eq(devices.id, appointments.deviceId))
    .where(
      and(
        gte(appointments.startsAt, opts.from),
        lt(appointments.startsAt, opts.to),
        opts.branchId ? eq(appointments.branchId, opts.branchId) : undefined,
        opts.practitionerId ? eq(appointments.practitionerId, opts.practitionerId) : undefined,
        opts.patientId ? eq(appointments.patientId, opts.patientId) : undefined,
      ),
    )
    .orderBy(asc(appointments.startsAt));
  const patientIds = rows.map((r) => r.p.id);
  const [waMessages, consents, alerts, pkgs, requests] = await Promise.all([
    rows.length
      ? tx
          .select({
            appointmentId: messages.appointmentId,
            kind: messages.kind,
            status: messages.status,
            errorCode: messages.errorCode,
            createdAt: messages.createdAt,
          })
          .from(messages)
          .where(
            and(
              eq(messages.direction, "out"),
              inArray(
                messages.appointmentId,
                rows.map((r) => r.a.id),
              ),
            ),
          )
          .orderBy(asc(messages.createdAt))
      : Promise.resolve([]),
    consentStatusFor(
      tx,
      rows.map((r) => ({ id: r.a.id, patientId: r.p.id, serviceId: r.s.id })),
    ),
    getPatientAlerts(tx, patientIds),
    packagesForPatients(tx, patientIds),
    rows.length
      ? tx
          .select()
          .from(rescheduleRequests)
          .where(
            and(
              eq(rescheduleRequests.status, "pending"),
              inArray(
                rescheduleRequests.appointmentId,
                rows.map((r) => r.a.id),
              ),
            ),
          )
      : Promise.resolve([]),
  ]);
  return rows.map(({ a, p, s, d }) => {
    const req = requests.find((r) => r.appointmentId === a.id);
    const bal = balanceFor(pkgs, p.id, s.id);
    return {
      id: a.id,
      branchId: a.branchId,
      startsAt: a.startsAt.toISOString(),
      endsAt: a.endsAt.toISOString(),
      blockedUntil: a.blockedUntil.toISOString(),
      status: a.status,
      source: a.source,
      needsCompletion: p.needsCompletion,
      practitionerId: a.practitionerId,
      roomId: a.roomId,
      deviceNameAr: d?.nameAr ?? null,
      deviceNameEn: d?.nameEn ?? null,
      serviceId: s.id,
      serviceNameAr: s.nameAr,
      serviceNameEn: s.nameEn,
      isVirtual: s.isVirtual,
      patient: {
        id: p.id,
        nameAr: p.fullNameAr,
        nameEn: p.fullNameEn,
        fileNumber: p.fileNumber,
        phone: p.phone,
      },
      alerts: alerts.get(p.id) ?? { allergies: [], contraindications: [], medications: [] },
      balance: bal ? { remaining: bal.remaining, total: bal.total } : null,
      note: a.receptionNote,
      pendingRequest: req ? { proposedStartsAt: req.proposedStartsAt.toISOString() } : null,
      whatsapp: waMessages
        .filter((m) => m.appointmentId === a.id)
        .map((m) => ({
          kind: m.kind,
          status: m.status,
          errorCode: m.errorCode,
          createdAt: m.createdAt.toISOString(),
        })),
      consent: (() => {
        const c = consents.get(a.id);
        return c
          ? {
              signed: c.signed,
              viaPatientPage: c.signedVia === "patient_portal",
              reason: reasonView(c),
            }
          : null;
      })(),
    };
  });
}

export async function loadBlocks(
  tx: TenantTx,
  opts: { branchId: string; from: Date; to: Date; memberId?: string },
): Promise<BlockView[]> {
  const rows = await tx
    .select()
    .from(timeBlocks)
    .where(
      and(
        eq(timeBlocks.branchId, opts.branchId),
        lt(timeBlocks.startsAt, opts.to),
        gte(timeBlocks.endsAt, opts.from),
        opts.memberId ? eq(timeBlocks.memberId, opts.memberId) : undefined,
      ),
    )
    .orderBy(asc(timeBlocks.startsAt));
  return rows.map((b) => ({
    id: b.id,
    memberId: b.memberId,
    roomId: b.roomId,
    startsAt: b.startsAt.toISOString(),
    endsAt: b.endsAt.toISOString(),
    reason: b.reason,
  }));
}
