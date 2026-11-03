/**
 * Consent renewal rules per template: every visit (default), once per package, valid N months,
 * until the text changes. Check-in and the patient page (/my) ask for a new signature by the
 * rule, and say why. Whatever the rule, a new template version needs a new signature.
 */
import { afterAll, describe, expect, it } from "vitest";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import { withActor, type Actor } from "@/lib/auth/db";
import { PermissionError } from "@/lib/auth/permissions";
import { bookAppointment, type Appointment } from "@/lib/booking/engine";
import {
  consentRulesByCode,
  consentStatusFor,
  ConsentError,
  currentTemplate,
  saveConsentRule,
  saveTemplateVersion,
  signConsent,
} from "@/lib/consents/consents";
import { addMonths, decideConsent, type Signature } from "@/lib/consents/rules";
import { sellPackage } from "@/lib/packages/packages";
import { loadPortal } from "@/lib/portal/data";
import { signConsentByPatient } from "@/lib/consents/consents";
import { withTenant } from "@/db/tenant";
import { checkIn } from "@/lib/visits/check-in";
import { demoId } from "@/db/seed-data";
import { admin, DERMA, member, patient, reception, riyadhAt, RIYADH, service } from "./fixtures";

afterAll(closeDb);

const as = <T>(actor: Actor, fn: Parameters<typeof withActor<T>>[1]) => withActor(actor, fn);
let png: Buffer;
async function signature() {
  png ??= await sharp({
    create: { width: 300, height: 120, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  })
    .composite([
      {
        input: Buffer.from(
          '<svg width="300" height="120"><path d="M10 80 Q 80 10 150 70 T 290 50" stroke="black" stroke-width="4" fill="none"/></svg>',
        ),
      },
    ])
    .png()
    .toBuffer();
  return png;
}

let slot = 0;
/** Fresh far-future slots (May 2034, used by no other test), one per call. */
const book = (serviceCode: string, file: string, day?: string): Promise<Appointment> => {
  const days = ["2034-05-07", "2034-05-08", "2034-05-09", "2034-05-10", "2034-05-14"];
  const times = ["10:00", "12:00", "15:00", "17:00"];
  const i = slot++;
  return as(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service(serviceCode),
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt(times[i % times.length], day ?? days[Math.floor(i / 4) % days.length]),
    }),
  );
};
const sign = async (file: string, code: string, appointmentId: string | null) => {
  const tpl = await as(reception, (tx) => currentTemplate(tx, code));
  return as(reception, async (tx) =>
    signConsent(tx, reception, {
      patientId: patient(file),
      templateId: tpl!.id,
      signerName: "توقيع تجريبي",
      signerRelation: "self",
      signaturePng: await signature(),
      appointmentId,
    }),
  );
};
const status = async (a: Appointment) =>
  (await as(reception, (tx) => consentStatusFor(tx, [a]))).get(a.id)!;
const setRule = (
  code: string,
  rule: "every_visit" | "per_package" | "months" | "template_change",
  months: number | null = null,
) => as(admin, (tx) => saveConsentRule(tx, admin, { code, rule, months }));

describe("the decision (pure)", () => {
  const sig = (templateId: string, appointmentId: string | null, signedAt: string): Signature => ({
    templateId,
    appointmentId,
    signedAt: new Date(signedAt),
    signedVia: "clinic",
  });
  const appt = { id: "visit-2", startsAt: new Date("2032-06-01T08:00:00Z") };
  const base = { months: null, currentTemplateId: "v2", appointment: appt, pkg: null };

  it("never signed / only an older version signed", () => {
    expect(decideConsent({ ...base, rule: "template_change", signatures: [] }).reason.code).toBe(
      "never_signed",
    );
    const old = decideConsent({
      ...base,
      rule: "template_change",
      signatures: [sig("v1", null, "2032-01-01")],
    });
    expect(old).toMatchObject({ signed: false, reason: { code: "text_changed" } });
  });

  it("every visit: only a signature for this appointment counts", () => {
    const d = (s: Signature[]) => decideConsent({ ...base, rule: "every_visit", signatures: s });
    expect(d([sig("v2", "visit-1", "2032-05-01")]).reason.code).toBe("previous_visit");
    expect(d([sig("v2", "visit-2", "2032-05-30")])).toMatchObject({
      signed: true,
      reason: { code: "signed_this_visit" },
    });
  });

  it("once per package: signed after the package was bought; no package → every visit", () => {
    const signatures = [sig("v2", "visit-1", "2032-03-01")];
    const d = (purchasedAt: string | null) =>
      decideConsent({
        ...base,
        rule: "per_package",
        pkg: purchasedAt ? { purchasedAt: new Date(purchasedAt) } : null,
        signatures,
      });
    expect(d("2032-02-20")).toMatchObject({
      signed: true,
      reason: { code: "signed_this_package" },
    });
    expect(d("2032-04-01")).toMatchObject({ signed: false, reason: { code: "before_package" } });
    expect(d(null)).toMatchObject({
      signed: false,
      rule: "every_visit",
      reason: { code: "previous_visit" },
    });
  });

  it("valid N months: counted to the visit's date", () => {
    const d = (signedAt: string) =>
      decideConsent({
        ...base,
        rule: "months",
        months: 6,
        signatures: [sig("v2", null, signedAt)],
      });
    expect(d("2032-01-15")).toMatchObject({ signed: true, reason: { code: "signed_within" } });
    expect(d("2031-11-15")).toMatchObject({ signed: false, reason: { code: "expired" } });
    expect(addMonths(new Date("2032-01-31T10:00:00Z"), 1).toISOString()).toBe(
      "2032-02-29T10:00:00.000Z",
    );
  });
});

describe("rules in the clinic (Derma seed)", () => {
  it("seeded: Botox/fillers and peel every visit, laser hair removal once per package", async () => {
    const rules = await as(admin, (tx) => consentRulesByCode(tx));
    expect(rules.get("injectables")?.rule).toBe("every_visit");
    expect(rules.get("chemical_peel")?.rule).toBe("every_visit");
    expect(rules.get("laser_hair_removal")?.rule).toBe("per_package");
  });

  it("every visit (Botox): last visit's signature doesn't count; check-in asks again", async () => {
    const first = await book("botox", "D-0031");
    const second = await book("botox", "D-0031");
    await sign("D-0031", "injectables", first.id);
    expect(await status(first)).toMatchObject({
      signed: true,
      reason: { code: "signed_this_visit" },
    });
    expect(await status(second)).toMatchObject({
      signed: false,
      reason: { code: "previous_visit" },
    });
    const r = await as(reception, (tx) => checkIn(tx, reception, second.id));
    expect(r.status).toBe("consent_required");
    await sign("D-0031", "injectables", second.id);
    const ok = await as(reception, (tx) => checkIn(tx, reception, second.id));
    expect(ok.status).toBe("checked_in");
  });

  it("once per package (laser): one signature covers the package; a new package needs a new one", async () => {
    const pkg = await as(reception, (tx) =>
      sellPackage(tx, reception, {
        patientId: patient("D-0032"),
        templateId: demoId("derma:package_template:lhr6"),
      }),
    );
    expect(pkg).toBeTruthy();
    const s1 = await book("laser_hair_removal", "D-0032");
    const s2 = await book("laser_hair_removal", "D-0032");
    expect((await status(s1)).reason.code).toBe("never_signed");
    await sign("D-0032", "laser_hair_removal", s1.id);
    expect(await status(s2)).toMatchObject({
      signed: true,
      rule: "per_package",
      reason: { code: "signed_this_package" },
    });
    const r = await as(reception, (tx) => checkIn(tx, reception, s2.id));
    expect(r.status).toBe("checked_in"); // no new signature for session 2
  });

  it("once per package, but no package: every visit", async () => {
    const v1 = await book("laser_hair_removal", "D-0033");
    const v2 = await book("laser_hair_removal", "D-0033");
    await sign("D-0033", "laser_hair_removal", v1.id);
    expect(await status(v2)).toMatchObject({
      signed: false,
      rule: "every_visit",
      reason: { code: "previous_visit" },
    });
  });

  it("valid N months (admin sets peel to 6 months)", async () => {
    await setRule("chemical_peel", "months", 6);
    try {
      const soon = await book("chemical_peeling", "D-0034", "2027-01-10");
      const late = await book("chemical_peeling", "D-0034", "2027-08-10");
      await sign("D-0034", "chemical_peel", null);
      expect(await status(soon)).toMatchObject({ signed: true, reason: { code: "signed_within" } });
      expect(await status(late)).toMatchObject({ signed: false, reason: { code: "expired" } });
    } finally {
      await setRule("chemical_peel", "every_visit");
    }
  });

  it("until the template changes — and a new version always needs a new signature", async () => {
    await setRule("chemical_peel", "template_change");
    try {
      const a = await book("chemical_peeling", "D-0035");
      await sign("D-0035", "chemical_peel", null);
      expect(await status(a)).toMatchObject({
        signed: true,
        reason: { code: "signed_current_version" },
      });
      const v1 = await as(admin, (tx) => currentTemplate(tx, "chemical_peel"));
      await as(admin, (tx) =>
        saveTemplateVersion(tx, admin, "chemical_peel", { ...v1!, bodyEn: `${v1!.bodyEn} (v+1)` }),
      );
      expect(await status(a)).toMatchObject({ signed: false, reason: { code: "text_changed" } });
    } finally {
      await setRule("chemical_peel", "every_visit");
    }
  });

  it("only the clinic admin sets rules (months between 1 and 120)", async () => {
    await expect(
      as(reception, (tx) =>
        saveConsentRule(tx, reception, { code: "injectables", rule: "months", months: 3 }),
      ),
    ).rejects.toBeInstanceOf(PermissionError);
    await expect(
      as(admin, (tx) =>
        saveConsentRule(tx, admin, { code: "nope", rule: "every_visit", months: null }),
      ),
    ).rejects.toBeInstanceOf(ConsentError);
  });
});

describe("the patient page (/my) follows the rule", () => {
  it("asks again for the next Botox visit, with the reason; a signature there counts for that visit", async () => {
    const first = await book("botox", "D-0036");
    await book("botox", "D-0036");
    await sign("D-0036", "injectables", first.id);
    const title = (await as(reception, (tx) => currentTemplate(tx, "injectables")))!.titleEn;
    const injectables = async () =>
      (await loadPortal(DERMA, patient("D-0036"))).pendingConsents.filter(
        (p) => p.titleEn === title,
      );
    // The next visit that needs it (this week's demo visit, or the 2032 one) — with the reason.
    const [pending] = await injectables();
    expect(pending.appointmentId).not.toBe(first.id);
    expect(pending.reason.code).toBe("previous_visit");

    await withTenant(DERMA, async (tx) =>
      signConsentByPatient(tx, {
        tenantId: DERMA,
        sessionPatientId: patient("D-0036"),
        patientId: patient("D-0036"),
        templateId: pending.templateId,
        appointmentId: pending.appointmentId,
        signerName: "مريضة تجريبية",
        signaturePng: await signature(),
      }),
    );
    const signedVisit = (
      await as(reception, (tx) =>
        consentStatusFor(tx, [
          { id: pending.appointmentId, patientId: patient("D-0036"), serviceId: service("botox") },
        ]),
      )
    ).get(pending.appointmentId);
    expect(signedVisit).toMatchObject({
      signed: true,
      signedVia: "patient_portal",
      reason: { code: "signed_this_visit" },
    });
    // The list moves on to the following visit (every visit needs its own signature).
    const next = await injectables();
    expect(next.every((p) => p.appointmentId !== pending.appointmentId)).toBe(true);
    expect(next.length).toBeGreaterThan(0);
  });

  it("a signature can't be attached to someone else's appointment", async () => {
    const other = await book("botox", "D-0037");
    const tpl = await as(reception, (tx) => currentTemplate(tx, "injectables"));
    await expect(
      withTenant(DERMA, async (tx) =>
        signConsentByPatient(tx, {
          tenantId: DERMA,
          sessionPatientId: patient("D-0036"),
          patientId: patient("D-0036"),
          templateId: tpl!.id,
          appointmentId: other.id,
          signerName: "مريضة تجريبية",
          signaturePng: await signature(),
        }),
      ),
    ).rejects.toBeInstanceOf(ConsentError);
  });
});
