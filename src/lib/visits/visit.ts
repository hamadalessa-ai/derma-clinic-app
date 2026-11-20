/**
 * The doctor's visit screen (/visits/<id>): one place to start the visit, write the note
 * (with the AI scribe) and finish with "Sign & complete".
 *
 * Rules: only the appointment's own doctor (practitioner role) — or a nurse / assistant of that
 * doctor, who brings the patient in and prepares the note (never signs); status changes go through the
 * booking engine; signing goes through the notes module. Both happen in ONE transaction, so a
 * visit is never completed without its signed note (or the other way round).
 */
import type { TenantTx } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { BookingError, changeStatus, getAppointment } from "@/lib/booking/engine";
import { assistsMember, doctorOf } from "@/lib/care-team/care-team";
import { NoteError, openDraft, signNote } from "@/lib/notes/notes";

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
  const note = await openDraft(tx, actor, {
    patientId: appt.patientId,
    appointmentId: appt.id,
    author,
  });
  return { noteId: note.id, patientId: appt.patientId };
}

/**
 * "Sign & complete": signs this visit's note and completes the visit. If the patient was never
 * checked in, the note is signed and the visit stays as it is (reception checks them in).
 */
export async function signAndComplete(
  tx: TenantTx,
  actor: Actor,
  input: { appointmentId: string; noteId: string; body: string },
): Promise<{ completed: boolean }> {
  const { appt } = await ownAppointment(tx, actor, input.appointmentId);
  // Only the doctor signs (signNote refuses anyone but the author).
  const note = await signNote(tx, actor, input.noteId, input.body);
  if (note.appointmentId !== appt.id) throw new NoteError("not_found");
  let status = appt.status;
  if (status === "arrived") {
    await changeStatus(tx, actor, appt.id, "in_session");
    status = "in_session";
  }
  if (status === "in_session") {
    await changeStatus(tx, actor, appt.id, "completed");
    return { completed: true };
  }
  return { completed: status === "completed" };
}
