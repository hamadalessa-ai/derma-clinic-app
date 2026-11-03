/** Packages, consents, check-in, notes and reschedule requests. */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import { appointments, auditLogs, patientConsents, patientPackages } from "@/db/schema";
import { demoId } from "@/db/seed-data";
import { withActor, type Actor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, BookingError, changeStatus } from "@/lib/booking/engine";
import {
  currentTemplate,
  isIntact,
  missingConsent,
  saveTemplateVersion,
  signConsent,
} from "@/lib/consents/consents";
import { getFileStore } from "@/lib/files/store";
import { addAddendum, notesForPatient, openDraft, saveDraft, signNote } from "@/lib/notes/notes";
import {
  deductForAppointment,
  overrideSessions,
  PackageError,
  paymentSummary,
  recordPayment,
  sellPackage,
} from "@/lib/packages/packages";
import { updateSettings } from "@/lib/settings";
import { checkIn } from "@/lib/visits/check-in";
import { decideRequest, doctorReschedule } from "@/lib/visits/reschedule";
import { dbError } from "./helpers";
import {
  admin,
  drFaisal,
  drLina,
  drSara,
  member,
  patient,
  reception,
  riyadhAt,
  RIYADH,
  service,
} from "./fixtures";

let signature: Buffer;
beforeAll(async () => {
  signature = await sharp({
    create: { width: 400, height: 150, channels: 4, background: "#ffffff" },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="400" height="150"><path d="M20 100 C 120 10, 200 140, 380 40" stroke="black" stroke-width="4" fill="none"/></svg>',
        ),
        top: 0,
        left: 0,
      },
    ])
    .png()
    .toBuffer();
});
afterAll(closeDb);

const as = <T>(actor: Actor, fn: Parameters<typeof withActor<T>>[1]) => withActor(actor, fn);

let slot = 0;
/** A new appointment on a fresh future weekday slot (avoids clashes between tests). */
async function newAppointment(serviceCode: string, patientFile: string, doctor = "derma-dr-sara") {
  const days = ["2030-02-03", "2030-02-04", "2030-02-05", "2030-02-06", "2030-02-07"];
  const times = ["10:00", "11:30", "15:00", "16:30", "18:00"];
  const i = slot++;
  return as(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(patientFile),
      serviceId: service(serviceCode),
      practitionerId: member(doctor),
      startsAt: riyadhAt(times[i % times.length], days[Math.floor(i / times.length) % days.length]),
    }),
  );
}

async function sign(actor: Actor, patientFile: string, code: string, appointmentId?: string) {
  return as(actor, async (tx) => {
    const tpl = await currentTemplate(tx, code);
    return signConsent(tx, actor, {
      patientId: patient(patientFile),
      templateId: tpl!.id,
      signerName: "توقيع تجريبي",
      signerRelation: "self",
      signaturePng: signature,
      appointmentId,
    });
  });
}

describe("packages", () => {
  it("sells a package with a partial payment, then tracks paid / outstanding", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0020"),
        templateId: demoId("derma:package_template:lhr6"),
        payment: { amountHalalas: 100000, method: "card" },
      }),
    );
    expect(pkg.sessionsTotal).toBe(6);
    expect(pkg.priceHalalas).toBe(360000);
    expect(pkg.expiresAt.getTime() - pkg.purchasedAt.getTime()).toBe(365 * 86400_000);
    expect(paymentSummary(360000, [{ amountHalalas: 100000 }])).toEqual({
      paid: 100000,
      outstanding: 260000,
      status: "partial",
    });
    await expect(
      as(reception, (tx) =>
        recordPayment(tx, reception, {
          patientPackageId: pkg.id,
          amountHalalas: 300000,
          method: "cash",
        }),
      ),
    ).rejects.toThrow(PackageError); // can't pay more than outstanding
    await as(reception, (tx) =>
      recordPayment(tx, reception, {
        patientPackageId: pkg.id,
        amountHalalas: 260000,
        method: "cash",
      }),
    );
  });

  it("deduction is idempotent: calling it many times (even at once) deducts one session", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0021"),
        templateId: demoId("derma:package_template:peel4"),
      }),
    );
    const appt = await newAppointment("chemical_peeling", "D-0021");
    await Promise.all(
      Array.from({ length: 5 }, () =>
        as(reception, (tx) => deductForAppointment(tx, reception, appt)),
      ),
    );
    await as(reception, (tx) => deductForAppointment(tx, reception, appt));
    const [after] = await as(reception, (tx) =>
      tx.select().from(patientPackages).where(eq(patientPackages.id, pkg.id)),
    );
    expect(after.sessionsUsed).toBe(1);
  });

  it("never goes below zero, and cannot be edited directly", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0022"),
        templateId: demoId("derma:package_template:boost3"),
      }),
    );
    // Give a session back when none were used → would go to -1 used → refused.
    await expect(
      as(reception, (tx) =>
        overrideSessions(tx, reception, {
          patientPackageId: pkg.id,
          delta: -1,
          reason: "خطأ إدخال",
        }),
      ),
    ).rejects.toThrow(PackageError);
    // Use all 3, then a 4th is refused by the database.
    for (let i = 0; i < 3; i++) {
      await as(reception, (tx) =>
        overrideSessions(tx, reception, {
          patientPackageId: pkg.id,
          delta: 1,
          reason: "جلسة سابقة",
        }),
      );
    }
    await expect(
      as(reception, (tx) =>
        overrideSessions(tx, reception, {
          patientPackageId: pkg.id,
          delta: 1,
          reason: "جلسة إضافية",
        }),
      ),
    ).rejects.toThrow(PackageError);
    expect(
      await dbError(() =>
        as(admin, (tx) =>
          tx.update(patientPackages).set({ sessionsUsed: 0 }).where(eq(patientPackages.id, pkg.id)),
        ),
      ),
    ).toMatch(/only change through package_session_events/);
  });

  it("an override needs a reason and is written to the audit log", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0023"),
        templateId: demoId("derma:package_template:lhr6"),
      }),
    );
    await expect(
      as(reception, (tx) =>
        overrideSessions(tx, reception, { patientPackageId: pkg.id, delta: 1, reason: "  " }),
      ),
    ).rejects.toThrow(PackageError);
    await as(reception, (tx) =>
      overrideSessions(tx, reception, {
        patientPackageId: pkg.id,
        delta: 1,
        reason: "جلسة في فرع آخر",
      }),
    );
    const logs = await as(reception, (tx) =>
      tx
        .select()
        .from(auditLogs)
        .where(and(eq(auditLogs.entityId, pkg.id), eq(auditLogs.action, "package.override"))),
    );
    expect(logs[0].metadata).toMatchObject({ reason: "جلسة في فرع آخر", delta: 1 });
  });

  it("doctors cannot sell packages", async () => {
    await expect(
      as(drSara, (tx) =>
        sellPackage(tx, drSara, {
          patientId: patient("D-0024"),
          templateId: demoId("derma:package_template:lhr6"),
        }),
      ),
    ).rejects.toThrow(PermissionError);
  });
});

describe("consents", () => {
  it("stores the official record: text snapshot, version, fingerprint, signature, witness", async () => {
    const c = await sign(reception, "D-0025", "injectables");
    expect(c.templateVersion).toBe(1);
    expect(c.bodyAr).toContain("صياغة تجريبية");
    expect(c.witnessUserId).toBe(reception.userId);
    expect(isIntact(c)).toBe(true);
    const file = await as(reception, (tx) => getFileStore().get({ tx }, c.signatureFileId));
    expect(file?.mimeType).toBe("image/png");
    expect(file!.sizeBytes).toBeLessThan(signature.length + 1); // compressed
  });

  it("signed consents can never be edited or deleted", async () => {
    const c = await sign(reception, "D-0026", "chemical_peel");
    expect(
      await dbError(() =>
        as(admin, (tx) =>
          tx.update(patientConsents).set({ signerName: "x" }).where(eq(patientConsents.id, c.id)),
        ),
      ),
    ).toMatch(/permission denied/);
    expect(
      await dbError(() =>
        as(admin, (tx) => tx.delete(patientConsents).where(eq(patientConsents.id, c.id))),
      ),
    ).toMatch(/permission denied/);
  });

  it("a new template version means patients must sign again", async () => {
    const appt = await newAppointment("fillers", "D-0027");
    const before = await as(reception, (tx) => missingConsent(tx, appt));
    expect(before?.code).toBe("injectables");
    await sign(reception, "D-0027", "injectables", appt.id);
    expect(await as(reception, (tx) => missingConsent(tx, appt))).toBeNull();

    // Admin edits the template → version 2 becomes current; old versions stay unchanged.
    const v1 = await as(admin, (tx) => currentTemplate(tx, "injectables"));
    const v2 = await as(admin, (tx) =>
      saveTemplateVersion(tx, admin, "injectables", {
        ...v1!,
        bodyAr: v1!.bodyAr + "\n\nبند إضافي.",
      }),
    );
    expect(v2.version).toBe(v1!.version + 1);
    expect((await as(reception, (tx) => missingConsent(tx, appt)))?.version).toBe(v2.version);
    expect(
      await dbError(() =>
        as(admin, (tx) =>
          tx.execute(
            `update consent_templates set body_ar = 'changed' where id = '${v1!.id}'` as never,
          ),
        ),
      ),
    ).toMatch(/permission denied/);
  });

  it("only the clinic admin edits templates; reception can collect signatures", async () => {
    const tpl = await as(reception, (tx) => currentTemplate(tx, "chemical_peel"));
    await expect(
      as(reception, (tx) => saveTemplateVersion(tx, reception, "chemical_peel", tpl!)),
    ).rejects.toThrow(PermissionError);
  });

  it("rejects a signature that isn't an image", async () => {
    await expect(
      as(reception, async (tx) => {
        const tpl = await currentTemplate(tx, "chemical_peel");
        return signConsent(tx, reception, {
          patientId: patient("D-0028"),
          templateId: tpl!.id,
          signerName: "اسم",
          signerRelation: "self",
          signaturePng: Buffer.from("not an image"),
        });
      }),
    ).rejects.toThrow(/bad_signature/);
  });
});

describe("check-in: consent → package deduction → arrived", () => {
  it("asks for consent first, then deducts exactly one session and marks arrived", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0029"),
        templateId: demoId("derma:package_template:lhr6"),
      }),
    );
    const appt = await newAppointment("laser_hair_removal", "D-0029", "derma-dr-faisal");

    const first = await as(reception, (tx) => checkIn(tx, reception, appt.id));
    expect(first.status).toBe("consent_required");
    const [still] = await as(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt.id)),
    );
    expect(still.status).toBe("booked"); // nothing changed yet

    await sign(reception, "D-0029", "laser_hair_removal", appt.id);
    const second = await as(reception, (tx) => checkIn(tx, reception, appt.id));
    expect(second).toEqual({
      status: "checked_in",
      deducted: true,
      packageId: pkg.id,
      remaining: 5,
    });

    // Double tap and simultaneous taps: no second deduction.
    const again = await Promise.all(
      [1, 2, 3].map(() => as(reception, (tx) => checkIn(tx, reception, appt.id))),
    );
    expect(again.every((r) => r.status === "already_checked_in")).toBe(true);
    const [after] = await as(reception, (tx) =>
      tx.select().from(patientPackages).where(eq(patientPackages.id, pkg.id)),
    );
    expect(after.sessionsUsed).toBe(1);
    const [arrived] = await as(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt.id)),
    );
    expect(arrived.status).toBe("arrived");
  });

  it("works without a package (nothing to deduct) and for services with no consent", async () => {
    const appt = await newAppointment("consultation", "D-0030");
    const r = await as(reception, (tx) => checkIn(tx, reception, appt.id));
    expect(r).toEqual({ status: "checked_in", deducted: false, packageId: null, remaining: null });
  });

  it("an expired package is not used", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0031"),
        templateId: demoId("derma:package_template:facial5"),
      }),
    );
    await as(admin, (tx) =>
      tx
        .update(patientPackages)
        .set({ expiresAt: new Date(Date.now() - 1000) })
        .where(eq(patientPackages.id, pkg.id)),
    );
    const appt = await newAppointment("facial_treatment", "D-0031");
    const r = await as(reception, (tx) => checkIn(tx, reception, appt.id));
    expect(r).toMatchObject({ status: "checked_in", deducted: false });
  });

  it("only reception/admin can check in", async () => {
    const appt = await newAppointment("consultation", "D-0032");
    await expect(as(drSara, (tx) => checkIn(tx, drSara, appt.id))).rejects.toThrow(PermissionError);
  });
});

describe("doctor actions on their own appointments", () => {
  it("a doctor confirms and starts/completes their own visit, but not someone else's", async () => {
    const mine = await newAppointment("consultation", "D-0033", "derma-dr-sara");
    const notMine = await newAppointment("consultation", "D-0034", "derma-dr-faisal");
    await as(drSara, (tx) => changeStatus(tx, drSara, mine.id, "confirmed"));
    await expect(
      as(drSara, (tx) => changeStatus(tx, drSara, notMine.id, "confirmed")),
    ).rejects.toThrow(BookingError);
    await expect(
      as(drSara, (tx) => changeStatus(tx, drSara, mine.id, "cancelled")),
    ).rejects.toThrow(BookingError);
    await as(reception, (tx) => checkIn(tx, reception, mine.id));
    await as(drSara, (tx) => changeStatus(tx, drSara, mine.id, "in_session"));
    const done = await as(drSara, (tx) => changeStatus(tx, drSara, mine.id, "completed"));
    expect(done.status).toBe("completed");
  });
});

describe("reschedule requests (clinic setting)", () => {
  it("setting OFF: the doctor's move becomes a request; reception approves and it moves", async () => {
    await as(admin, (tx) => updateSettings(tx, admin, { doctorsManageOwnSchedule: false }));
    const appt = await newAppointment("consultation", "D-0035", "derma-dr-sara");
    const target = riyadhAt("19:00", "2030-02-13");
    const r = await as(drSara, (tx) =>
      doctorReschedule(tx, drSara, { appointmentId: appt.id, startsAt: target, reason: "مؤتمر" }),
    );
    expect(r.mode).toBe("requested");
    const [unchanged] = await as(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt.id)),
    );
    expect(unchanged.startsAt.toISOString()).toBe(appt.startsAt.toISOString());
    await expect(
      as(drSara, (tx) =>
        decideRequest(tx, drSara, {
          requestId: (r as { request: { id: string } }).request.id,
          approve: true,
        }),
      ),
    ).rejects.toThrow(PermissionError);
    await as(reception, (tx) =>
      decideRequest(tx, reception, {
        requestId: (r as { request: { id: string } }).request.id,
        approve: true,
      }),
    );
    const [moved] = await as(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt.id)),
    );
    expect(moved.startsAt.toISOString()).toBe(target.toISOString());
  });

  it("setting OFF: a rejected request leaves the appointment where it was", async () => {
    const appt = await newAppointment("consultation", "D-0036", "derma-dr-sara");
    const r = await as(drSara, (tx) =>
      doctorReschedule(tx, drSara, {
        appointmentId: appt.id,
        startsAt: riyadhAt("18:00", "2030-02-14"),
      }),
    );
    const decided = await as(reception, (tx) =>
      decideRequest(tx, reception, {
        requestId: (r as { request: { id: string } }).request.id,
        approve: false,
        note: "لا يوجد موعد",
      }),
    );
    expect(decided.status).toBe("rejected");
    const [same] = await as(reception, (tx) =>
      tx.select().from(appointments).where(eq(appointments.id, appt.id)),
    );
    expect(same.startsAt.toISOString()).toBe(appt.startsAt.toISOString());
  });

  it("setting ON: the doctor moves their own appointment directly, but never someone else's", async () => {
    await as(admin, (tx) => updateSettings(tx, admin, { doctorsManageOwnSchedule: true }));
    const mine = await newAppointment("consultation", "D-0037", "derma-dr-sara");
    const r = await as(drSara, (tx) =>
      doctorReschedule(tx, drSara, {
        appointmentId: mine.id,
        startsAt: riyadhAt("17:00", "2030-02-13"),
      }),
    );
    expect(r.mode).toBe("moved");
    const other = await newAppointment("consultation", "D-0038", "derma-dr-faisal");
    await expect(
      as(drSara, (tx) =>
        doctorReschedule(tx, drSara, {
          appointmentId: other.id,
          startsAt: riyadhAt("17:30", "2030-02-13"),
        }),
      ),
    ).rejects.toThrow(BookingError);
    await as(admin, (tx) => updateSettings(tx, admin, { doctorsManageOwnSchedule: false }));
  });

  it("only the clinic admin can change the setting", async () => {
    await expect(
      as(reception, (tx) => updateSettings(tx, reception, { doctorsManageOwnSchedule: true })),
    ).rejects.toThrow(PermissionError);
  });
});

describe("clinical notes", () => {
  it("draft → signed → addendum, by the practitioner", async () => {
    const sara = { ...drSara, name: "د. سارة العتيبي" };
    const draft = await as(sara, (tx) => openDraft(tx, sara, { patientId: patient("D-0001") }));
    await as(sara, (tx) => saveDraft(tx, sara, draft.id, "الشكوى: تصبغات. الخطة: تقشير خفيف."));
    const signed = await as(sara, (tx) => signNote(tx, sara, draft.id));
    expect(signed.status).toBe("signed");
    await expect(as(sara, (tx) => saveDraft(tx, sara, draft.id, "تعديل"))).rejects.toThrow(
      /signed/,
    );
    await as(sara, (tx) => addAddendum(tx, sara, draft.id, "تمت مراجعة الحساسية من الليدوكايين."));
    const notes = await as(drLina, (tx) => notesForPatient(tx, drLina, patient("D-0001")));
    expect(notes[0].addenda).toHaveLength(1);
  });

  it("receptionists and admins cannot read or write notes", async () => {
    await expect(
      as(reception, (tx) => notesForPatient(tx, reception, patient("D-0001"))),
    ).rejects.toThrow(PermissionError);
    await expect(
      as(admin, (tx) => openDraft(tx, admin, { patientId: patient("D-0001") })),
    ).rejects.toThrow(PermissionError);
  });

  it("an empty note cannot be signed", async () => {
    const draft = await as(drFaisal, (tx) =>
      openDraft(tx, drFaisal, { patientId: patient("D-0002") }),
    );
    await expect(as(drFaisal, (tx) => signNote(tx, drFaisal, draft.id))).rejects.toThrow(/empty/);
  });
});
