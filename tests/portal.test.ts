/**
 * The patient page (/my): sessions, what it shows, and signing consents before the visit.
 *  - sessions: hashed token, 30 minutes, revocable, per clinic,
 *  - shows own + family data only, NEVER clinical notes,
 *  - a consent signed on /my is the official record (no clinic witness, signed_via patient_portal)
 *    and check-in no longer asks for it.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, sql } from "drizzle-orm";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import { auditLogs, consentTemplates, patientConsents, patientSessions } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookOnline } from "@/lib/booking/engine";
import { ConsentError, currentTemplate, signConsentByPatient } from "@/lib/consents/consents";
import { loadPortal } from "@/lib/portal/data";
import {
  createPatientSession,
  hashToken,
  patientForToken,
  revokePatientSession,
} from "@/lib/portal/session";
import { checkIn } from "@/lib/visits/check-in";
import { DERMA, LAMSA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

const GUARDIAN = patient("D-0008");
const CHILD = patient("D-0039");
const NOW = riyadhAt("08:00", "2031-06-01");

let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 300, height: 120, channels: 4, background: "#ffffff" } })
    .composite([
      {
        input: Buffer.from(
          '<svg width="300" height="120"><path d="M10 90 C 90 10, 160 110, 290 30" stroke="black" stroke-width="4" fill="none"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
});
afterAll(closeDb);

const system = <T>(fn: Parameters<typeof withTenant<T>>[1]) => withTenant(DERMA, fn);

describe("patient sessions", () => {
  it("works with the token; only the hash is stored", async () => {
    const { token } = await system((tx) =>
      createPatientSession(tx, { tenantId: DERMA, patientId: GUARDIAN, ip: null }),
    );
    expect((await patientForToken(DERMA, token))?.patientId).toBe(GUARDIAN);
    const rows = await system((tx) =>
      tx
        .select()
        .from(patientSessions)
        .where(eq(patientSessions.tokenHash, hashToken(token))),
    );
    expect(rows).toHaveLength(1);
    expect(JSON.stringify(rows)).not.toContain(token);
  });

  it("lasts 30 minutes", async () => {
    const { expiresAt } = await system((tx) =>
      createPatientSession(tx, { tenantId: DERMA, patientId: GUARDIAN, ip: null }),
    );
    const minutes = (expiresAt.getTime() - Date.now()) / 60_000;
    expect(minutes).toBeGreaterThan(29);
    expect(minutes).toBeLessThanOrEqual(30.1);
  });

  it("expired, revoked, unknown or other-clinic tokens give nothing", async () => {
    const { token } = await system((tx) =>
      createPatientSession(tx, { tenantId: DERMA, patientId: GUARDIAN, ip: null }),
    );
    expect(await patientForToken(LAMSA, token)).toBeNull();
    expect(await patientForToken(DERMA, "x".repeat(43))).toBeNull();
    expect(await patientForToken(DERMA, "")).toBeNull();
    await revokePatientSession(DERMA, token);
    expect(await patientForToken(DERMA, token)).toBeNull();

    const other = await system((tx) =>
      createPatientSession(tx, { tenantId: DERMA, patientId: GUARDIAN, ip: null }),
    );
    await system((tx) =>
      tx
        .update(patientSessions)
        .set({ expiresAt: sql`now() - interval '1 minute'` })
        .where(eq(patientSessions.tokenHash, hashToken(other.token))),
    );
    expect(await patientForToken(DERMA, other.token)).toBeNull();
  });
});

describe("what the patient page shows", () => {
  it("own and family data — the guardian sees the child's appointment; the child not the guardian's", async () => {
    const g = await loadPortal(DERMA, GUARDIAN);
    expect(new Set(g.family.map((f) => f.id))).toEqual(
      new Set([GUARDIAN, CHILD, patient("D-0040")]),
    );
    expect([...g.upcoming, ...g.past].some((a) => a.patientId === CHILD)).toBe(true);
    const c = await loadPortal(DERMA, CHILD);
    expect(c.family.map((f) => f.id)).toEqual([CHILD]);
    expect([...c.upcoming, ...c.past].every((a) => a.patientId === CHILD)).toBe(true);
  });

  it("never contains clinical notes", async () => {
    // D-0001 has signed notes and an addendum (seeded by Dr. Sara).
    const notes = await withActor(
      { ...reception, roles: ["practitioner"], userId: "usr_derma-dr-sara" },
      (tx) =>
        tx.execute(sql`select body from clinical_notes where patient_id = ${patient("D-0001")}`),
    );
    expect(notes.length).toBeGreaterThan(0);
    const page = JSON.stringify(await loadPortal(DERMA, patient("D-0001")));
    for (const n of notes as unknown as { body: string }[]) {
      expect(page).not.toContain(n.body.slice(0, 20));
    }
    expect(page).not.toMatch(/clinical|note_|addend/i);
  });

  it("other patients' data never appears", async () => {
    const page = await loadPortal(DERMA, patient("D-0003"));
    const ids = new Set([
      ...page.upcoming.map((a) => a.patientId),
      ...page.past.map((a) => a.patientId),
      ...page.packages.map((p) => p.patientId),
      ...page.signed.map((c) => c.patientId),
    ]);
    expect([...ids].every((id) => id === patient("D-0003"))).toBe(true);
  });

  it("D-0007 (demo story) has a consent to sign before the online Botox visit", async () => {
    const page = await loadPortal(DERMA, patient("D-0007"));
    expect(page.pendingConsents.length + page.signed.length).toBeGreaterThan(0);
  });
});

describe("signing a consent on the patient page", () => {
  it("a guardian signs for the child; check-in then doesn't ask again", async () => {
    const appt = await system((tx) =>
      bookOnline(tx, {
        tenantId: DERMA,
        branchId: RIYADH,
        serviceId: service("botox"),
        patientId: CHILD,
        practitionerId: member("derma-dr-sara"),
        startsAt: riyadhAt("11:00", "2031-06-02"),
        now: NOW,
      }),
    );
    const before = await loadPortal(DERMA, GUARDIAN, NOW);
    const todo = before.pendingConsents.find(
      (c) => c.patientId === CHILD && c.appointmentId === appt.id,
    );
    expect(todo).toBeTruthy();

    const consent = await system((tx) =>
      signConsentByPatient(tx, {
        tenantId: DERMA,
        sessionPatientId: GUARDIAN,
        patientId: CHILD,
        templateId: todo!.templateId,
        appointmentId: appt.id,
        signerName: "بندر الغامدي",
        signaturePng: png,
      }),
    );
    expect(consent.signedVia).toBe("patient_portal");
    expect(consent.witnessUserId).toBeNull();
    expect(consent.signerRelation).toBe("guardian");
    expect(consent.contentSha256).toMatch(/^[0-9a-f]{64}$/);

    const [log] = await system((tx) =>
      tx.select().from(auditLogs).where(eq(auditLogs.entityId, consent.id)),
    );
    expect(log.actorUserId).toBeNull();
    expect(log.metadata).toMatchObject({ via: "patient_page", signedInPatientId: GUARDIAN });

    // Reception's check-in goes straight through (no consent screen).
    const r = await withActor(reception, (tx) => checkIn(tx, reception, appt.id));
    expect(r.status).toBe("checked_in");
  });

  it("nobody can sign for a patient who isn't theirs", async () => {
    const tpl = await system((tx) => currentTemplate(tx, "injectables"));
    await expect(
      system((tx) =>
        signConsentByPatient(tx, {
          tenantId: DERMA,
          sessionPatientId: CHILD,
          patientId: GUARDIAN,
          templateId: tpl!.id,
          signerName: "طفل",
          signaturePng: png,
        }),
      ),
    ).rejects.toBeInstanceOf(ConsentError);
  });

  it("an old template version can't be signed", async () => {
    const old = await system((tx) =>
      tx.select().from(consentTemplates).where(eq(consentTemplates.isCurrent, false)).limit(1),
    );
    if (!old.length) return; // no old versions in this run
    await expect(
      system((tx) =>
        signConsentByPatient(tx, {
          tenantId: DERMA,
          sessionPatientId: GUARDIAN,
          patientId: GUARDIAN,
          templateId: old[0].id,
          signerName: "بندر",
          signaturePng: png,
        }),
      ),
    ).rejects.toThrow("not_current");
  });

  it("the database refuses a clinic-signed record without a witness", async () => {
    const tpl = await system((tx) => currentTemplate(tx, "injectables"));
    const err = await system((tx) =>
      tx.insert(patientConsents).values({
        tenantId: DERMA,
        patientId: GUARDIAN,
        templateId: tpl!.id,
        templateCode: tpl!.code,
        templateVersion: tpl!.version,
        titleAr: tpl!.titleAr,
        titleEn: tpl!.titleEn,
        bodyAr: tpl!.bodyAr,
        bodyEn: tpl!.bodyEn,
        contentSha256: "x".repeat(64),
        signerName: "x",
        signerRelation: "self",
        signatureFileId: tpl!.id,
        witnessUserId: null,
        signedVia: "clinic",
      }),
    ).then(
      () => "ok",
      (e: { cause?: { message?: string } }) => e.cause?.message ?? String(e),
    );
    expect(err).toMatch(/patient_consents_witness/);
  });
});
