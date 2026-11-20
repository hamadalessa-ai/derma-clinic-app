/**
 * The visit screen (/visits/<id>): start the visit, write the note (with the AI scribe), add the
 * doctor's orders (medications, treatment plan) and the invoice codes, then ONE "Post visit".
 *
 * Rules: only the appointment's own doctor — or a nurse / assistant of that doctor (care team),
 * who works in the doctor's name. Status changes go through the booking engine; the note through
 * the notes module. Posting = note final + visit completed in ONE transaction; afterwards the
 * note, orders and codes are locked (corrections are added underneath), also in the database.
 */
import { and, asc, eq } from "drizzle-orm";
import {
  billingItems,
  packageSessionEvents,
  services,
  visitCharges,
  visitOrders,
} from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import {
  BookingError,
  changeStatus,
  getAppointment,
  markDoctorWithPatient,
} from "@/lib/booking/engine";
import { assistsMember, doctorOf } from "@/lib/care-team/care-team";
import { NoteError, openDraft, postNote } from "@/lib/notes/notes";

export class VisitError extends Error {
  constructor(public code: "locked" | "bad_item" | "not_found" | "no_note") {
    super(code);
    this.name = "VisitError";
  }
}

const CLOSED = ["completed", "cancelled", "no_show"];

/**
 * The appointment, if this actor works on it: its own doctor — or a nurse / assistant of that
 * doctor (care team), who works in the doctor's name.
 */
async function ownAppointment(tx: TenantTx, actor: Actor, appointmentId: string) {
  assertCan(actor.roles, "notes:write");
  const appt = await getAppointment(tx, appointmentId, true);
  if (actor.memberId && appt.practitionerId === actor.memberId) return { appt, author: undefined };
  if (await assistsMember(tx, actor, appt.practitionerId)) {
    const d = await doctorOf(tx, appt.practitionerId);
    return { appt, author: { userId: d.userId, name: d.name } };
  }
  throw new BookingError("not_allowed");
}

/** May this actor open the visit screen of this appointment (own doctor or her assistant)? */
export async function mayWorkOnVisit(tx: TenantTx, actor: Actor, practitionerMemberId: string) {
  if (actor.memberId && practitionerMemberId === actor.memberId) return true;
  return assistsMember(tx, actor, practitionerMemberId);
}

/**
 * "Start visit": the patient has arrived → "with the doctor", and this visit's note draft is
 * ready (created once; the same draft is reused). Before arrival the note can still be prepared.
 */
export async function startVisit(
  tx: TenantTx,
  actor: Actor,
  appointmentId: string,
): Promise<{ noteId: string; patientId: string }> {
  const { appt, author } = await ownAppointment(tx, actor, appointmentId);
  if (["cancelled", "no_show", "pending"].includes(appt.status)) {
    throw new BookingError("bad_status");
  }
  if (appt.status === "arrived") await changeStatus(tx, actor, appt.id, "in_session");
  // The doctor themself started it: the doctor is with the patient (reception board).
  if (!author && ["arrived", "in_session"].includes(appt.status)) {
    await markDoctorWithPatient(tx, appt.id);
  }
  const note = await openDraft(tx, actor, {
    patientId: appt.patientId,
    appointmentId: appt.id,
    author,
  });
  await ensureServiceCharge(tx, actor, appt);
  return { noteId: note.id, patientId: appt.patientId };
}

/**
 * "Post visit": the note becomes final (posted, in the doctor's name), and the visit is
 * completed — in ONE transaction. The doctor or her nurse / assistant may post. If the patient
 * was never checked in, the note is posted and the visit stays as it is (reception checks in).
 */
/**
 * Nurse / assistant: the patient is prepared — "ready for the doctor". Records the time (the
 * reception board moves the patient to "with doctor") and tells the doctor (push, by the caller).
 */
export async function readyForDoctor(tx: TenantTx, actor: Actor, appointmentId: string) {
  assertCan(actor.roles, "visits:assist");
  const { appt, author } = await ownAppointment(tx, actor, appointmentId);
  if (!author) throw new BookingError("not_allowed"); // the doctor doesn't call themself
  const r = await markDoctorWithPatient(tx, appt.id);
  if (r.changed) {
    await audit(tx, {
      actorUserId: actor.userId,
      action: "visit.ready_for_doctor",
      entityType: "appointment",
      entityId: appt.id,
    });
  }
  return { changed: r.changed };
}

export async function postVisit(
  tx: TenantTx,
  actor: Actor,
  input: { appointmentId: string; noteId: string; body: string },
): Promise<{ completed: boolean }> {
  const { appt } = await ownAppointment(tx, actor, input.appointmentId);
  const note = await postNote(tx, actor, input.noteId, input.body);
  if (note.appointmentId !== appt.id) throw new NoteError("not_found");
  let status = appt.status;
  if (status === "arrived") {
    await changeStatus(tx, actor, appt.id, "in_session");
    status = "in_session";
  }
  let completed = status === "completed";
  if (status === "in_session") {
    await changeStatus(tx, actor, appt.id, "completed");
    completed = true;
  }
  const { charges, orders } = await visitExtras(tx, appt.id);
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.post",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { noteId: note.id, charges: charges.length, orders: orders.length, completed },
  });
  return { completed };
}

/** Older name, kept for callers: posting replaced signing. */
export const signAndComplete = postVisit;

// ─── Orders and invoice codes ───────────────────────────────────────────────

/** The visit, if this actor works on it AND it is still open (not posted / cancelled / no-show). */
async function openVisit(tx: TenantTx, actor: Actor, appointmentId: string) {
  const own = await ownAppointment(tx, actor, appointmentId);
  if (CLOSED.includes(own.appt.status)) throw new VisitError("locked");
  return own;
}

/** A visit's invoice codes and orders (oldest first). */
export async function visitExtras(tx: TenantTx, appointmentId: string) {
  const [charges, orders] = await Promise.all([
    tx
      .select()
      .from(visitCharges)
      .where(eq(visitCharges.appointmentId, appointmentId))
      .orderBy(asc(visitCharges.createdAt), asc(visitCharges.id)),
    tx
      .select()
      .from(visitOrders)
      .where(eq(visitOrders.appointmentId, appointmentId))
      .orderBy(asc(visitOrders.createdAt), asc(visitOrders.id)),
  ]);
  return { charges, orders };
}

/**
 * The booked service as the visit's first invoice line (once). A package session that paid for
 * it at check-in makes the line "covered by package" (amount 0 on the invoice).
 */
export async function ensureServiceCharge(
  tx: TenantTx,
  actor: Actor,
  appt: { id: string; patientId: string; serviceId: string },
) {
  const [any] = await tx
    .select({ id: visitCharges.id })
    .from(visitCharges)
    .where(eq(visitCharges.appointmentId, appt.id))
    .limit(1);
  if (any) return;
  const [svc] = await tx.select().from(services).where(eq(services.id, appt.serviceId));
  if (!svc) return;
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
  await tx.insert(visitCharges).values({
    tenantId: actor.tenantId,
    appointmentId: appt.id,
    patientId: appt.patientId,
    serviceId: svc.id,
    code: svc.code,
    nameAr: svc.nameAr,
    nameEn: svc.nameEn,
    quantity: 1,
    unitPriceHalalas: svc.priceHalalas,
    coveredByPackage: !!deduction,
    addedByUserId: actor.userId,
  });
}

/** Adds a line from the clinic's services or price list (the code, name and price of today). */
export async function addCharge(
  tx: TenantTx,
  actor: Actor,
  input: {
    appointmentId: string;
    serviceId?: string | null;
    billingItemId?: string | null;
    quantity: number;
  },
) {
  const { appt } = await openVisit(tx, actor, input.appointmentId);
  let line: { code: string; nameAr: string; nameEn: string; priceHalalas: number } | undefined;
  if (input.billingItemId) {
    [line] = await tx
      .select({
        code: billingItems.code,
        nameAr: billingItems.nameAr,
        nameEn: billingItems.nameEn,
        priceHalalas: billingItems.priceHalalas,
      })
      .from(billingItems)
      .where(and(eq(billingItems.id, input.billingItemId), eq(billingItems.isActive, true)));
  } else if (input.serviceId) {
    [line] = await tx
      .select({
        code: services.code,
        nameAr: services.nameAr,
        nameEn: services.nameEn,
        priceHalalas: services.priceHalalas,
      })
      .from(services)
      .where(eq(services.id, input.serviceId));
  }
  if (!line) throw new VisitError("bad_item");
  const [row] = await tx
    .insert(visitCharges)
    .values({
      tenantId: actor.tenantId,
      appointmentId: appt.id,
      patientId: appt.patientId,
      serviceId: input.billingItemId ? null : input.serviceId!,
      billingItemId: input.billingItemId ?? null,
      code: line.code,
      nameAr: line.nameAr,
      nameEn: line.nameEn,
      quantity: input.quantity,
      unitPriceHalalas: line.priceHalalas,
      addedByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.charge_add",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { code: line.code, quantity: input.quantity },
  });
  return row;
}

export async function removeCharge(
  tx: TenantTx,
  actor: Actor,
  input: { appointmentId: string; chargeId: string },
) {
  const { appt } = await openVisit(tx, actor, input.appointmentId);
  const gone = await tx
    .delete(visitCharges)
    .where(and(eq(visitCharges.id, input.chargeId), eq(visitCharges.appointmentId, appt.id)))
    .returning({ code: visitCharges.code });
  if (!gone.length) throw new VisitError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.charge_remove",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { code: gone[0]!.code },
  });
}

export interface OrderInput {
  appointmentId: string;
  kind: "medication" | "treatment";
  name: string;
  dose?: string | null;
  frequency?: string | null;
  duration?: string | null;
  sessions?: number | null;
  intervalWeeks?: number | null;
  serviceId?: string | null;
  instructions?: string | null;
}

/** A medication or a treatment plan line (doctor's orders; clinic instructions, not Wasfaty). */
export async function addOrder(tx: TenantTx, actor: Actor, input: OrderInput) {
  const { appt } = await openVisit(tx, actor, input.appointmentId);
  const clean = (v?: string | null) => v?.trim() || null;
  const name = input.name.trim();
  if (!name) throw new VisitError("bad_item");
  const [row] = await tx
    .insert(visitOrders)
    .values({
      tenantId: actor.tenantId,
      appointmentId: appt.id,
      patientId: appt.patientId,
      kind: input.kind,
      name,
      dose: input.kind === "medication" ? clean(input.dose) : null,
      frequency: input.kind === "medication" ? clean(input.frequency) : null,
      duration: input.kind === "medication" ? clean(input.duration) : null,
      sessions: input.kind === "treatment" ? (input.sessions ?? null) : null,
      intervalWeeks: input.kind === "treatment" ? (input.intervalWeeks ?? null) : null,
      serviceId: input.kind === "treatment" ? (input.serviceId ?? null) : null,
      instructions: clean(input.instructions),
      createdByUserId: actor.userId,
    })
    .returning();
  // Never the medication or instructions themselves in the audit log.
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.order_add",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { kind: input.kind },
  });
  return row;
}

export async function removeOrder(
  tx: TenantTx,
  actor: Actor,
  input: { appointmentId: string; orderId: string },
) {
  const { appt } = await openVisit(tx, actor, input.appointmentId);
  const gone = await tx
    .delete(visitOrders)
    .where(and(eq(visitOrders.id, input.orderId), eq(visitOrders.appointmentId, appt.id)))
    .returning({ kind: visitOrders.kind });
  if (!gone.length) throw new VisitError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "visit.order_remove",
    entityType: "appointment",
    entityId: appt.id,
    metadata: { kind: gone[0]!.kind },
  });
}
