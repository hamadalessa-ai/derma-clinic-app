/**
 * Clinical notes: Draft → Signed. Signed notes are final (database trigger); corrections
 * are addenda. Only the practitioner role can read or write (database RLS + checks here).
 * This is the base the AI scribe will fill in Phase 2 (it will create drafts only).
 */
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { clinicalNoteAddenda, clinicalNotes } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";

export type ClinicalNote = typeof clinicalNotes.$inferSelect;
export type Addendum = typeof clinicalNoteAddenda.$inferSelect;

export class NoteError extends Error {
  constructor(public code: "not_found" | "empty" | "signed" | "not_author") {
    super(code);
    this.name = "NoteError";
  }
}

const MAX = 20_000;

/** The author's draft for a visit (creates one if needed). */
export async function openDraft(
  tx: TenantTx,
  actor: Actor,
  input: { patientId: string; appointmentId?: string | null },
) {
  assertCan(actor.roles, "notes:write");
  if (input.appointmentId) {
    const [existing] = await tx
      .select()
      .from(clinicalNotes)
      .where(
        and(
          eq(clinicalNotes.appointmentId, input.appointmentId),
          eq(clinicalNotes.authorUserId, actor.userId),
        ),
      )
      .orderBy(desc(clinicalNotes.createdAt))
      .limit(1);
    if (existing) return existing;
  }
  const [note] = await tx
    .insert(clinicalNotes)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      authorUserId: actor.userId,
      authorName: actor.name ?? actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "note.create",
    entityType: "clinical_note",
    entityId: note.id,
  });
  return note;
}

async function loadOwnDraft(tx: TenantTx, actor: Actor, id: string) {
  const [note] = await tx
    .select()
    .from(clinicalNotes)
    .where(eq(clinicalNotes.id, id))
    .for("update")
    .limit(1);
  if (!note) throw new NoteError("not_found");
  if (note.status === "signed") throw new NoteError("signed");
  if (note.authorUserId !== actor.userId) throw new NoteError("not_author");
  return note;
}

export async function saveDraft(tx: TenantTx, actor: Actor, id: string, body: string) {
  assertCan(actor.roles, "notes:write");
  await loadOwnDraft(tx, actor, id);
  const [note] = await tx
    .update(clinicalNotes)
    .set({ body: body.slice(0, MAX) })
    .where(eq(clinicalNotes.id, id))
    .returning();
  // The note text itself is never copied into the audit log.
  await audit(tx, {
    actorUserId: actor.userId,
    action: "note.save_draft",
    entityType: "clinical_note",
    entityId: id,
    metadata: { length: note.body.length },
  });
  return note;
}

export async function signNote(tx: TenantTx, actor: Actor, id: string, body?: string) {
  assertCan(actor.roles, "notes:write");
  const draft = await loadOwnDraft(tx, actor, id);
  const finalBody = (body ?? draft.body).slice(0, MAX);
  if (!finalBody.trim()) throw new NoteError("empty");
  const [note] = await tx
    .update(clinicalNotes)
    .set({ body: finalBody, status: "signed", signedAt: new Date() })
    .where(eq(clinicalNotes.id, id))
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "note.sign",
    entityType: "clinical_note",
    entityId: id,
  });
  return note;
}

export async function addAddendum(tx: TenantTx, actor: Actor, noteId: string, body: string) {
  assertCan(actor.roles, "notes:write");
  const text = body.trim().slice(0, MAX);
  if (!text) throw new NoteError("empty");
  const [a] = await tx
    .insert(clinicalNoteAddenda)
    .values({
      tenantId: actor.tenantId,
      noteId,
      authorUserId: actor.userId,
      authorName: actor.name ?? actor.userId,
      body: text,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "note.addendum",
    entityType: "clinical_note",
    entityId: noteId,
  });
  return a;
}

/** Notes for a patient, newest first, with their addenda. */
export async function notesForPatient(tx: TenantTx, actor: Actor, patientId: string) {
  assertCan(actor.roles, "clinical_notes:read");
  const notes = await tx
    .select()
    .from(clinicalNotes)
    .where(eq(clinicalNotes.patientId, patientId))
    .orderBy(desc(clinicalNotes.createdAt));
  const addenda = notes.length
    ? await tx
        .select()
        .from(clinicalNoteAddenda)
        .where(
          inArray(
            clinicalNoteAddenda.noteId,
            notes.map((n) => n.id),
          ),
        )
        .orderBy(asc(clinicalNoteAddenda.createdAt))
    : [];
  return notes.map((n) => ({ ...n, addenda: addenda.filter((a) => a.noteId === n.id) }));
}
