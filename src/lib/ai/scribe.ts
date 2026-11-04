/**
 * The AI scribe: the doctor speaks their notes during the visit (browser dictation in the demo —
 * the audio never reaches us, only the recognised text), and Claude turns that text into a
 * structured ENGLISH clinical note draft. The doctor reviews, edits and signs it.
 *
 * Rules (enforced here, not only in the prompt):
 *  - only the note's author, with the practitioner role, on a DRAFT note (signed notes are final);
 *  - the clinic switched the scribe on, and an API key is set;
 *  - the draft is saved into the note body and marked (ai_drafted_at); nothing is signed for them;
 *  - the spoken text itself is never stored (only the draft the doctor will review).
 *
 * Not a medical device: it writes down only what the doctor said — no diagnoses, codes, doses or
 * recommendations of its own (see SYSTEM below).
 */
import { eq, sql } from "drizzle-orm";
import { appointments, clinicalNotes, services } from "@/db/schema";
import { withActor, type Actor } from "@/lib/auth/db";
import { audit } from "@/lib/audit";
import { assertCan } from "@/lib/auth/permissions";
import { getSettings } from "@/lib/booking/engine";
import { riyadhDay } from "@/lib/booking/time";
import type { ClaudeClient } from "./claude";

const MAX_TRANSCRIPT = 20_000;
const MAX_NOTE = 20_000;

export class ScribeError extends Error {
  constructor(
    public code:
      | "not_configured"
      | "disabled"
      | "empty"
      | "not_found"
      | "signed"
      | "not_author"
      | "failed",
  ) {
    super(code);
    this.name = "ScribeError";
  }
}

export const SCRIBE_SYSTEM = `You are a medical scribe for a dermatology and aesthetic clinic in Saudi Arabia.
You receive a doctor's spoken notes from automatic speech recognition. They may be in Saudi Arabic, English or a mix, and may contain recognition errors.
Turn them into a concise clinical note draft IN ENGLISH, for the doctor to review, edit and sign.

Rules (never break these):
- Write ONLY what the doctor said. Never add diagnoses, findings, ICD codes, drug names, doses, device settings, treatments or recommendations that were not said.
- Translate Arabic into standard English medical terminology. Keep numbers, units, device names, settings, products and doses exactly as said.
- If something is unclear or looks like a recognition error, keep your best reading and mark it [check: …]. If a value is missing or garbled, write [unclear].
- No patient names, phone numbers or ID numbers.
- Plain text only (no markdown symbols). Use these headings, in this order, and leave out any heading with nothing said:
Reason for visit:
History:
Allergies / medications mentioned:
Examination:
Assessment (as stated by the doctor):
Procedure:
Aftercare given:
Plan / follow-up:
- Short phrases or bullets starting with "- ". Return only the note.`;

/** One request to the model: the visit context line + the spoken text. */
export function scribeMessage(context: string, transcript: string) {
  return `${context}\n\nDoctor's spoken notes (speech recognition):\n"""\n${transcript}\n"""`;
}

/**
 * Drafts the note from the doctor's spoken text and saves it into the draft (appended below any
 * text already there). Returns the new note body.
 */
export async function scribeDraft(
  actor: Actor,
  input: { noteId: string; transcript: string },
  opts: { client: ClaudeClient | null },
): Promise<{ body: string }> {
  assertCan(actor.roles, "notes:write");
  const transcript = input.transcript.trim().slice(0, MAX_TRANSCRIPT);
  if (transcript.length < 5) throw new ScribeError("empty");
  if (!opts.client) throw new ScribeError("not_configured");

  // 1. Check (short transaction): the clinic allows it, and it's the doctor's own draft.
  const context = await withActor(actor, async (tx) => {
    const settings = await getSettings(tx);
    if (!settings.aiScribeEnabled) throw new ScribeError("disabled");
    const [note] = await tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, input.noteId));
    if (!note) throw new ScribeError("not_found");
    if (note.status === "signed") throw new ScribeError("signed");
    if (note.authorUserId !== actor.userId) throw new ScribeError("not_author");
    let visit = "";
    if (note.appointmentId) {
      const [a] = await tx
        .select({ startsAt: appointments.startsAt, service: services.nameEn })
        .from(appointments)
        .innerJoin(services, eq(services.id, appointments.serviceId))
        .where(eq(appointments.id, note.appointmentId));
      if (a) visit = `Visit: ${a.service ?? ""}, ${riyadhDay(a.startsAt)}.`;
    }
    return visit || "Visit: dermatology clinic.";
  });

  // 2. The model (outside any database transaction).
  let draft: string;
  try {
    const res = await opts.client.create({
      system: SCRIBE_SYSTEM,
      messages: [{ role: "user", content: scribeMessage(context, transcript) }],
      tools: [],
      maxTokens: 1500,
      timeoutMs: 45_000,
    });
    draft = res.content
      .filter((b): b is { type: "text"; text: string } => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  } catch (err) {
    console.warn("ai scribe failed", err instanceof Error ? err.message : err);
    throw new ScribeError("failed");
  }
  if (!draft) throw new ScribeError("failed");

  // 3. Save into the draft (re-checked: still the author's unsigned draft).
  return withActor(actor, async (tx) => {
    const [note] = await tx
      .select()
      .from(clinicalNotes)
      .where(eq(clinicalNotes.id, input.noteId))
      .for("update");
    if (!note) throw new ScribeError("not_found");
    if (note.status === "signed") throw new ScribeError("signed");
    if (note.authorUserId !== actor.userId) throw new ScribeError("not_author");
    const body = (note.body.trim() ? `${note.body.trimEnd()}\n\n${draft}` : draft).slice(
      0,
      MAX_NOTE,
    );
    await tx
      .update(clinicalNotes)
      .set({ body, aiDraftedAt: sql`now()` })
      .where(eq(clinicalNotes.id, input.noteId));
    // The note text and the spoken words are never copied into the audit log.
    await audit(tx, {
      actorUserId: actor.userId,
      action: "note.ai_draft",
      entityType: "clinical_note",
      entityId: input.noteId,
      metadata: { spokenChars: transcript.length, draftChars: draft.length },
    });
    return { body };
  });
}
