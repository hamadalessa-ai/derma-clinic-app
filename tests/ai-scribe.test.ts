/**
 * The AI scribe: spoken notes → an English draft in the doctor's OWN unsigned note.
 * Driven by a scripted fake model (no real API calls).
 */
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { auditLogs, clinicalNotes, tenantSettings } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import type { ClaudeClient, ClaudeRequest } from "@/lib/ai/claude";
import { SCRIBE_SYSTEM, scribeDraft, ScribeError } from "@/lib/ai/scribe";
import { openDraft, saveDraft, signNote } from "@/lib/notes/notes";
import { DERMA, drFaisal, drSara, patient, reception } from "./fixtures";

afterAll(closeDb);

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);
const DRAFT =
  "Reason for visit:\n- Laser hair removal, session 4\n\nPlan / follow-up:\n- Next session in 6 weeks";

function fake(text = DRAFT) {
  const calls: ClaudeRequest[] = [];
  const client: ClaudeClient = {
    async create(req) {
      calls.push(req);
      return { content: [{ type: "text", text }], stopReason: "end_turn" };
    },
  };
  return { client, calls };
}

async function newNote(file: string, actor = drSara) {
  // A fresh draft each time (no appointment: openDraft always creates one).
  return withActor(actor, (tx) => openDraft(tx, actor, { patientId: patient(file) }));
}
/** Read as Dr. Sara: notes are hidden from anyone without the practitioner role (RLS). */
const noteRow = async (id: string) =>
  (
    await withActor(drSara, (tx) => tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, id)))
  )[0];

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (err) {
    return err instanceof ScribeError ? err.code : (err as Error).name;
  }
  return "no_error";
}

beforeEach(async () => {
  await system((tx) => tx.update(tenantSettings).set({ aiScribeEnabled: true }));
});

describe("AI scribe", () => {
  it("drafts an English note into the doctor's own draft, marked as AI draft", async () => {
    const note = await newNote("D-0003");
    const { client, calls } = fake();
    const spoken = "المريضة جلسة ليزر رابعة للإبط، الإعدادات ٢٢ جول، الجلسة الجاية بعد ستة أسابيع";
    const r = await scribeDraft(drSara, { noteId: note.id, transcript: spoken }, { client });
    expect(r.body).toBe(DRAFT);
    const row = await noteRow(note.id);
    expect(row.body).toBe(DRAFT);
    expect(row.status).toBe("draft"); // never signed for the doctor
    expect(row.aiDraftedAt).not.toBeNull();

    // The model got the rules and the spoken words; no patient name.
    expect(calls).toHaveLength(1);
    expect(calls[0].system).toBe(SCRIBE_SYSTEM);
    expect(calls[0].system).toContain("Write ONLY what the doctor said");
    expect(calls[0].system).toContain("IN ENGLISH");
    expect(String(calls[0].messages[0].content)).toContain(spoken);

    // Audited without copying the note or the spoken words.
    const [log] = await system((tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.action, "note.ai_draft"), eq(auditLogs.entityId, note.id))),
    );
    expect(log).toBeDefined();
    expect(JSON.stringify(log.metadata)).not.toContain("ليزر");
    expect(JSON.stringify(log.metadata)).not.toContain("Laser");
  });

  it("adds the draft below what the doctor already wrote", async () => {
    const note = await newNote("D-0004");
    await withActor(drSara, (tx) => saveDraft(tx, drSara, note.id, "Seen with mother."));
    await scribeDraft(drSara, { noteId: note.id, transcript: "follow up in six weeks" }, fake());
    expect((await noteRow(note.id)).body).toBe(`Seen with mother.\n\n${DRAFT}`);
  });

  it("refuses signed notes, other doctors' notes and non-doctors", async () => {
    const signed = await newNote("D-0005");
    await withActor(drSara, (tx) => signNote(tx, drSara, signed.id, "Final note."));
    expect(
      await code(scribeDraft(drSara, { noteId: signed.id, transcript: "more text" }, fake())),
    ).toBe("signed");
    expect((await noteRow(signed.id)).body).toBe("Final note.");

    const saras = await newNote("D-0006");
    expect(
      await code(scribeDraft(drFaisal, { noteId: saras.id, transcript: "not my note" }, fake())),
    ).toBe("not_author");

    expect(
      await code(scribeDraft(reception, { noteId: saras.id, transcript: "reception" }, fake())),
    ).not.toBe("no_error");
    expect((await noteRow(saras.id)).body).toBe("");
  });

  it("needs the clinic switch, a key, and some text", async () => {
    const note = await newNote("D-0007");
    expect(
      await code(
        scribeDraft(drSara, { noteId: note.id, transcript: "hello there" }, { client: null }),
      ),
    ).toBe("not_configured");
    expect(await code(scribeDraft(drSara, { noteId: note.id, transcript: "  " }, fake()))).toBe(
      "empty",
    );
    await system((tx) => tx.update(tenantSettings).set({ aiScribeEnabled: false }));
    const off = fake();
    expect(
      await code(scribeDraft(drSara, { noteId: note.id, transcript: "hello there" }, off)),
    ).toBe("disabled");
    expect(off.calls).toHaveLength(0);
  });

  it("a model failure changes nothing", async () => {
    const note = await newNote("D-0009");
    await withActor(drSara, (tx) => saveDraft(tx, drSara, note.id, "Keep me."));
    const broken: ClaudeClient = {
      async create() {
        throw new Error("Claude API 529: overloaded");
      },
    };
    expect(
      await code(
        scribeDraft(drSara, { noteId: note.id, transcript: "some notes" }, { client: broken }),
      ),
    ).toBe("failed");
    const row = await noteRow(note.id);
    expect(row.body).toBe("Keep me.");
    expect(row.aiDraftedAt).toBeNull();
  });
});
