/**
 * "Correct note": the author fixes their signed note within 7 days; the database keeps every
 * earlier text (clinical_note_versions, written by the notes guard itself). Nobody else, and
 * not after 7 days — then only addenda. Reception never sees notes or their versions.
 */
import { afterAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { clinicalNotes, clinicalNoteVersions } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { correctionOpen, correctNote, NoteError, openDraft, signNote } from "@/lib/notes/notes";
import { drFaisal, drSara, patient, reception } from "./fixtures";

afterAll(closeDb);

const P = patient("D-0031");

async function signedNote(text: string) {
  return withActor(drSara, async (tx) => {
    const d = await openDraft(tx, drSara, { patientId: P });
    return signNote(tx, drSara, d.id, text);
  });
}
const versions = (noteId: string) =>
  withActor(drSara, (tx) =>
    tx.select().from(clinicalNoteVersions).where(eq(clinicalNoteVersions.noteId, noteId)),
  );
async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof NoteError) return e.code;
    return "db_refused";
  }
  return "ok";
}

describe("correcting a signed note", () => {
  it("is open for 7 days after signing", () => {
    const now = new Date("2036-06-10T10:00:00Z");
    const day = 86_400_000;
    expect(correctionOpen({ status: "signed", signedAt: new Date(now.getTime() - 6 * day) }, now)).toBe(true);
    expect(correctionOpen({ status: "signed", signedAt: new Date(now.getTime() - 8 * day) }, now)).toBe(false);
    expect(correctionOpen({ status: "draft", signedAt: null }, now)).toBe(false);
  });

  it("replaces the text and keeps every earlier version, oldest first", async () => {
    const note = await signedNote("Botox 20 units glabella. Review 2 weeks.");
    await withActor(drSara, (tx) =>
      correctNote(tx, drSara, note.id, "Botox 24 units glabella. Review 2 weeks."),
    );
    await withActor(drSara, (tx) =>
      correctNote(tx, drSara, note.id, "Botox 24 units glabella. Review 3 weeks."),
    );
    const [now] = await withActor(drSara, (tx) =>
      tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, note.id)),
    );
    expect(now.body).toBe("Botox 24 units glabella. Review 3 weeks.");
    expect(now.status).toBe("signed");
    expect(now.correctedAt).not.toBeNull();
    const v = (await versions(note.id)).sort((a, b) => a.version - b.version);
    expect(v.map((x) => x.version)).toEqual([1, 2]);
    expect(v[0].body).toBe("Botox 20 units glabella. Review 2 weeks.");
    expect(v[1].body).toBe("Botox 24 units glabella. Review 2 weeks.");
  });

  it("only the author may correct; an unchanged text is refused", async () => {
    const note = await signedNote("Peel session 2.");
    expect(await code(withActor(drFaisal, (tx) => correctNote(tx, drFaisal, note.id, "x")))).not.toBe(
      "ok",
    );
    expect(await code(withActor(drSara, (tx) => correctNote(tx, drSara, note.id, "Peel session 2.")))).toBe(
      "unchanged",
    );
  });

  it("after 7 days the app and the database both refuse (addenda only)", async () => {
    const old = new Date(Date.now() - 8 * 86_400_000);
    const [note] = await withActor(drSara, (tx) =>
      tx
        .insert(clinicalNotes)
        .values({
          tenantId: drSara.tenantId,
          patientId: P,
          authorUserId: drSara.userId,
          authorName: "Dr. Sarah",
          body: "Old note.",
          status: "signed",
          signedAt: old,
        })
        .returning(),
    );
    expect(await code(withActor(drSara, (tx) => correctNote(tx, drSara, note.id, "Changed.")))).toBe(
      "correction_closed",
    );
    // Straight to the database, skipping the app's check: the guard refuses too.
    expect(
      await code(
        withActor(drSara, (tx) =>
          tx
            .update(clinicalNotes)
            .set({ body: "Changed.", correctedAt: new Date() })
            .where(eq(clinicalNotes.id, note.id)),
        ),
      ),
    ).toBe("db_refused");
  });

  it("a signed note's text can't change without the correction mark (no silent edits)", async () => {
    const note = await signedNote("Laser session 3.");
    expect(
      await code(
        withActor(drSara, (tx) =>
          tx.update(clinicalNotes).set({ body: "Edited." }).where(eq(clinicalNotes.id, note.id)),
        ),
      ),
    ).toBe("db_refused");
  });

  it("reception never sees earlier versions", async () => {
    const note = await signedNote("Filler 1 ml.");
    await withActor(drSara, (tx) => correctNote(tx, drSara, note.id, "Filler 1.5 ml."));
    const seen = await withActor(reception, (tx) =>
      tx.select().from(clinicalNoteVersions).where(eq(clinicalNoteVersions.noteId, note.id)),
    );
    expect(seen).toHaveLength(0);
  });
});
