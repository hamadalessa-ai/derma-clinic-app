/**
 * The doctor's visit screen: "Start visit" (arrived → with the doctor + the visit's note draft)
 * and "Sign & complete" (note signed AND visit completed, in one transaction).
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { appointments, clinicalNotes } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, BookingError } from "@/lib/booking/engine";
import { NoteError } from "@/lib/notes/notes";
import { checkIn } from "@/lib/visits/check-in";
import { signAndComplete, startVisit } from "@/lib/visits/visit";
import {
  drFaisal,
  drSara,
  member,
  patient,
  reception,
  RIYADH,
  riyadhAt,
  service,
} from "./fixtures";

afterAll(closeDb);

const DAY = "2036-03-09"; // a Sunday no other test uses

async function booked(file: string, time: string) {
  return withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("consultation"), // no consent form needed
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt(time, DAY),
    }),
  );
}
const status = async (id: string) =>
  (
    await withActor(reception, (tx) =>
      tx.select({ s: appointments.status }).from(appointments).where(eq(appointments.id, id)),
    )
  )[0].s;
const note = async (id: string) =>
  (
    await withActor(drSara, (tx) => tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)))
  )[0];

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof BookingError || e instanceof NoteError) return e.code;
    throw e;
  }
  return "ok";
}

describe("visit screen", () => {
  it("Start visit: arrived → with the doctor, and one note draft for the visit", async () => {
    const a = await booked("D-0016", "10:00");
    await withActor(reception, (tx) => checkIn(tx, reception, a.id));
    expect(await status(a.id)).toBe("arrived");

    expect(await code(withActor(drFaisal, (tx) => startVisit(tx, drFaisal, a.id)))).toBe(
      "not_allowed",
    ); // not his patient
    const first = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    expect(await status(a.id)).toBe("in_session");
    const again = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    expect(again.noteId).toBe(first.noteId); // same draft, never a second one
    expect((await note(first.noteId)).appointmentId).toBe(a.id);

    // An empty note can't be signed, and then nothing changes.
    expect(
      await code(
        withActor(drSara, (tx) =>
          signAndComplete(tx, drSara, { appointmentId: a.id, noteId: first.noteId, body: "  " }),
        ),
      ),
    ).toBe("empty");
    expect(await status(a.id)).toBe("in_session");

    const r = await withActor(drSara, (tx) =>
      signAndComplete(tx, drSara, {
        appointmentId: a.id,
        noteId: first.noteId,
        body: "Reason for visit:\n- Acne review",
      }),
    );
    expect(r.completed).toBe(true);
    expect(await status(a.id)).toBe("completed");
    const n = await note(first.noteId);
    expect(n.status).toBe("signed");
    expect(n.body).toContain("Acne review");
  });

  it("before check-in: the note can be prepared and signed, the visit stays booked", async () => {
    const a = await booked("D-0017", "11:00");
    const s = await withActor(drSara, (tx) => startVisit(tx, drSara, a.id));
    expect(await status(a.id)).toBe("booked");
    const r = await withActor(drSara, (tx) =>
      signAndComplete(tx, drSara, { appointmentId: a.id, noteId: s.noteId, body: "Prepared." }),
    );
    expect(r.completed).toBe(false);
    expect(await status(a.id)).toBe("booked");
    expect((await note(s.noteId)).status).toBe("signed");
  });

  it("a note from another visit can't complete this one", async () => {
    const a = await booked("D-0018", "12:00");
    const b = await booked("D-0018", "16:00");
    const other = await withActor(drSara, (tx) => startVisit(tx, drSara, b.id));
    expect(
      await code(
        withActor(drSara, (tx) =>
          signAndComplete(tx, drSara, { appointmentId: a.id, noteId: other.noteId, body: "x" }),
        ),
      ),
    ).toBe("not_found");
    expect((await note(other.noteId)).status).toBe("draft"); // rolled back
  });
});
