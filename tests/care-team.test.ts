/**
 * Nurse / assistant: works for the doctors linked in care_team. She brings the patient in and
 * prepares the note IN THE DOCTOR'S NAME (recorded as entered by her); only the doctor signs.
 * She never sees other doctors' notes; reception still sees none. Enforced in the database too.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, clinicalNotes } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError } from "@/lib/booking/engine";
import { assistedDoctors, CareTeamError, setCareTeam } from "@/lib/care-team/care-team";
import { NoteError, openDraft, saveDraft } from "@/lib/notes/notes";
import { checkIn } from "@/lib/visits/check-in";
import { signAndComplete, startVisit } from "@/lib/visits/visit";
import {
  admin,
  drReem,
  drSara,
  member,
  nurse,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-03-23"; // a Sunday no other test uses

async function bookedWith(doctor: string, file: string, time: string) {
  const a = await withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("consultation"),
      practitionerId: member(doctor),
      startsAt: riyadhAt(time, DAY),
    }),
  );
  await withActor(reception, (tx) => checkIn(tx, reception, a.id));
  return a;
}
const statusOf = async (id: string) =>
  (
    await withActor(reception, (tx) =>
      tx.select({ s: appointments.status }).from(appointments).where(eq(appointments.id, id)),
    )
  )[0]!.s;
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError || e instanceof NoteError || e instanceof CareTeamError)
      return e.code;
    throw e;
  }
  return "ok";
}

describe("nurse / assistant", () => {
  it("is linked to Dr. Sara and Dr. Faisal in the demo", async () => {
    const team = await withActor(nurse, (tx) => assistedDoctors(tx, nurse));
    expect(team.map((d) => d.memberId).sort()).toEqual(
      [member("derma-dr-sara"), member("derma-dr-faisal")].sort(),
    );
  });

  it("brings the patient in and prepares the note in the doctor's name; only the doctor signs", async () => {
    const a = await bookedWith("derma-dr-sara", "D-0021", "10:00");
    const { noteId } = await withActor(nurse, (tx) => startVisit(tx, nurse, a.id));
    expect(await statusOf(a.id)).toBe("in_session");

    await withActor(nurse, (tx) => saveDraft(tx, nurse, noteId, "BP 120/80. Prepared for review."));
    const [n] = await withActor(drSara, (tx) =>
      tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId)),
    );
    expect(n).toMatchObject({
      authorUserId: drSara.userId,
      enteredByUserId: nurse.userId,
      status: "draft",
    });

    // She can't sign — not through the app, not straight in the database.
    expect(
      await code(
        withActor(nurse, (tx) =>
          signAndComplete(tx, nurse, { appointmentId: a.id, noteId, body: "signed?" }),
        ),
      ),
    ).toBe("not_author");
    await expect(
      withActor(nurse, (tx) =>
        tx
          .update(clinicalNotes)
          .set({ status: "signed", signedAt: new Date() })
          .where(eq(clinicalNotes.id, noteId)),
      ),
    ).rejects.toThrow();

    // The doctor reviews and signs: visit completed, same note, still marked as entered by her.
    const r = await withActor(drSara, (tx) =>
      signAndComplete(tx, drSara, { appointmentId: a.id, noteId, body: n!.body + " Reviewed." }),
    );
    expect(r.completed).toBe(true);
    expect(await statusOf(a.id)).toBe("completed");
  });

  it("never works on other doctors' patients or sees their notes", async () => {
    const a = await bookedWith("derma-dr-reem", "D-0022", "11:00");
    expect(await code(withActor(nurse, (tx) => startVisit(tx, nurse, a.id)))).toBe("not_allowed");
    const reemNote = await withActor(drReem, (tx) =>
      openDraft(tx, drReem, { patientId: patient("D-0022"), appointmentId: a.id }),
    );
    const seenByNurse = await withActor(nurse, (tx) =>
      tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, reemNote.id)),
    );
    expect(seenByNurse).toHaveLength(0);
    const seenByReception = await withActor(reception, (tx) => tx.select().from(clinicalNotes));
    expect(seenByReception).toHaveLength(0);
    // Nor can she start a note of her own (notes are always a doctor's).
    await expect(
      withActor(nurse, (tx) => openDraft(tx, nurse, { patientId: patient("D-0022") })),
    ).rejects.toThrow();
  });

  it("the admin decides which doctors she works with", async () => {
    await expect(
      withActor(reception, (tx) => setCareTeam(tx, reception, nurse.memberId!, [])),
    ).rejects.toThrow(PermissionError);
    expect(
      await code(
        withActor(admin, (tx) =>
          setCareTeam(tx, admin, nurse.memberId!, [member("derma-rec-ruh1")]),
        ),
      ),
    ).toBe("not_doctor");

    await withActor(admin, (tx) =>
      setCareTeam(tx, admin, nurse.memberId!, [
        member("derma-dr-sara"),
        member("derma-dr-faisal"),
        member("derma-dr-reem"),
      ]),
    );
    const a = await bookedWith("derma-dr-reem", "D-0023", "12:00");
    expect(await code(withActor(nurse, (tx) => startVisit(tx, nurse, a.id)))).toBe("ok");
    // Back to the demo's team, so other tests see the seeded state.
    await withActor(admin, (tx) =>
      setCareTeam(tx, admin, nurse.memberId!, [member("derma-dr-sara"), member("derma-dr-faisal")]),
    );
  });
});
