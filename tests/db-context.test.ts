/**
 * The database knows WHO is asking (user, roles, branches), not just which clinic.
 * These tests prove the walls hold in Postgres itself, below the app.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import { closeDb } from "@/db/client";
import { withTenant } from "@/db/tenant";
import { clinicalNoteAddenda, clinicalNotes, timeBlocks } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { withActor, type Actor } from "@/lib/auth/db";
import { dbError } from "./helpers";

const DERMA = demoId("tenant:derma");
const RIYADH = demoId("derma:branch:riyadh");
const JEDDAH = demoId("derma:branch:jeddah");
const PATIENT = demoId("derma:patient:D-0001");

const admin: Actor = {
  tenantId: DERMA,
  userId: "usr_derma-admin",
  roles: ["clinic_admin"],
  memberId: demoId("derma:member:derma-admin"),
  restrictedBranchId: null,
};
const drSara: Actor = {
  tenantId: DERMA,
  userId: "usr_derma-dr-sara",
  roles: ["practitioner"],
  memberId: demoId("derma:member:derma-dr-sara"),
  restrictedBranchId: RIYADH,
};
const drLina: Actor = {
  tenantId: DERMA,
  userId: "usr_derma-dr-lina",
  roles: ["practitioner"],
  memberId: demoId("derma:member:derma-dr-lina"),
  restrictedBranchId: JEDDAH,
};
const reception: Actor = {
  tenantId: DERMA,
  userId: "usr_derma-rec-ruh1",
  roles: ["receptionist"],
  memberId: demoId("derma:member:derma-rec-ruh1"),
  restrictedBranchId: RIYADH,
};

// Far in the future so they never collide with demo appointments.
const at = (h: number) => new Date(Date.UTC(2030, 0, 6, h, 0));
const blockIds: string[] = [];

beforeAll(async () => {
  const rows = await withActor(admin, (tx) =>
    tx
      .insert(timeBlocks)
      .values([
        {
          tenantId: DERMA,
          branchId: RIYADH,
          memberId: drSara.memberId,
          startsAt: at(7),
          endsAt: at(8),
          reason: "test-riyadh",
        },
        {
          tenantId: DERMA,
          branchId: JEDDAH,
          memberId: drLina.memberId,
          startsAt: at(7),
          endsAt: at(8),
          reason: "test-jeddah",
        },
      ])
      .returning({ id: timeBlocks.id }),
  );
  blockIds.push(...rows.map((r) => r.id));
});

afterAll(async () => {
  await withActor(admin, async (tx) => {
    for (const id of blockIds) await tx.delete(timeBlocks).where(eq(timeBlocks.id, id));
  });
  await closeDb();
});

describe("branch walls", () => {
  const reasons = (actor: Actor) =>
    withActor(actor, (tx) =>
      tx
        .select({ reason: timeBlocks.reason })
        .from(timeBlocks)
        .where(sql`${timeBlocks.reason} like 'test-%'`),
    ).then((rows) => rows.map((r) => r.reason).sort());

  it("an unrestricted admin sees both branches", async () => {
    expect(await reasons(admin)).toEqual(["test-jeddah", "test-riyadh"]);
  });

  it("a Jeddah-only doctor sees only Jeddah", async () => {
    expect(await reasons(drLina)).toEqual(["test-jeddah"]);
  });

  it("a Riyadh-only receptionist sees only Riyadh", async () => {
    expect(await reasons(reception)).toEqual(["test-riyadh"]);
  });

  it("a Jeddah-only doctor cannot write into Riyadh", async () => {
    expect(
      await dbError(() =>
        withActor(drLina, (tx) =>
          tx.insert(timeBlocks).values({
            tenantId: DERMA,
            branchId: RIYADH,
            memberId: drLina.memberId,
            startsAt: at(9),
            endsAt: at(10),
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("with no branch setting at all, branch rows are hidden (fail closed)", async () => {
    const n = await withTenant(DERMA, async (tx) => {
      await tx.execute(sql`select set_config('app.branch_ids', '', true)`);
      const rows = await tx.select().from(timeBlocks);
      return rows.length;
    });
    expect(n).toBe(0);
  });
});

describe("clinical notes are for practitioners only (database-enforced)", () => {
  let noteId: string;

  beforeAll(async () => {
    const [note] = await withActor(drSara, (tx) =>
      tx
        .insert(clinicalNotes)
        .values({
          tenantId: DERMA,
          patientId: PATIENT,
          authorUserId: drSara.userId,
          authorName: "د. سارة العتيبي",
          body: "مسودة اختبار",
        })
        .returning(),
    );
    noteId = note.id;
  });

  it("a practitioner can read notes", async () => {
    const rows = await withActor(drLina, (tx) =>
      tx.select().from(clinicalNotes).where(eq(clinicalNotes.id, noteId)),
    );
    expect(rows).toHaveLength(1);
  });

  it.each([
    ["receptionist", reception],
    ["clinic admin without practitioner role", admin],
  ])("a %s sees no notes, even with a raw query", async (_label, actor) => {
    const rows = await withActor(actor, (tx) => tx.execute(sql`select * from clinical_notes`));
    expect(rows).toHaveLength(0);
  });

  it("a receptionist cannot write a note", async () => {
    expect(
      await dbError(() =>
        withActor(reception, (tx) =>
          tx.insert(clinicalNotes).values({
            tenantId: DERMA,
            patientId: PATIENT,
            authorUserId: reception.userId,
            authorName: "x",
            body: "x",
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("a note cannot be written in someone else's name", async () => {
    expect(
      await dbError(() =>
        withActor(drLina, (tx) =>
          tx.insert(clinicalNotes).values({
            tenantId: DERMA,
            patientId: PATIENT,
            authorUserId: drSara.userId,
            authorName: "x",
            body: "x",
          }),
        ),
      ),
    ).toMatch(/row-level security/);
  });

  it("only the author can edit a draft", async () => {
    const changed = await withActor(drLina, (tx) =>
      tx
        .update(clinicalNotes)
        .set({ body: "تعديل" })
        .where(eq(clinicalNotes.id, noteId))
        .returning(),
    );
    expect(changed).toHaveLength(0);
  });

  it("addenda are only allowed on signed notes", async () => {
    expect(
      await dbError(() =>
        withActor(drSara, (tx) =>
          tx.insert(clinicalNoteAddenda).values({
            tenantId: DERMA,
            noteId,
            authorUserId: drSara.userId,
            authorName: "x",
            body: "إضافة",
          }),
        ),
      ),
    ).toMatch(/signed notes/);
  });

  it("once signed, a note cannot be changed (only an addendum)", async () => {
    await withActor(drSara, (tx) =>
      tx
        .update(clinicalNotes)
        .set({ status: "signed", signedAt: new Date() })
        .where(eq(clinicalNotes.id, noteId)),
    );
    expect(
      await dbError(() =>
        withActor(drSara, (tx) =>
          tx
            .update(clinicalNotes)
            .set({ body: "تغيير بعد التوقيع" })
            .where(eq(clinicalNotes.id, noteId)),
        ),
      ),
    ).toMatch(/signed notes cannot be changed/);
    const [addendum] = await withActor(drSara, (tx) =>
      tx
        .insert(clinicalNoteAddenda)
        .values({
          tenantId: DERMA,
          noteId,
          authorUserId: drSara.userId,
          authorName: "x",
          body: "إضافة",
        })
        .returning(),
    );
    expect(addendum.noteId).toBe(noteId);
  });

  it("notes can never be deleted", async () => {
    expect(
      await dbError(() =>
        withActor(drSara, (tx) => tx.delete(clinicalNotes).where(eq(clinicalNotes.id, noteId))),
      ),
    ).toMatch(/permission denied/);
  });
});

describe("withTenant input checks", () => {
  it("rejects malformed roles, users and branches", async () => {
    await expect(
      withTenant({ tenantId: DERMA, roles: ["admin;drop"] }, async () => 1),
    ).rejects.toThrow();
    await expect(
      withTenant({ tenantId: DERMA, userId: "x' or 1=1" }, async () => 1),
    ).rejects.toThrow();
    await expect(
      withTenant({ tenantId: DERMA, branchIds: ["jeddah"] }, async () => 1),
    ).rejects.toThrow();
  });
});
