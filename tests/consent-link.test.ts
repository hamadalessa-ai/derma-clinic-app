/**
 * Consent links from WhatsApp (/sign/<token>): signed for one clinic and one visit, they open
 * the consent THIS visit needs and record the signature as the patient's (no code, no sign-in).
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { closeDb } from "@/db/client";
import { patientConsents } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { withActor } from "@/lib/auth/db";
import { bookAppointment, changeStatus } from "@/lib/booking/engine";
import { ConsentError, missingConsent, signConsentByLink } from "@/lib/consents/consents";
import { consentToken, parseConsentToken, videoToken } from "@/lib/video/link";
import { appointmentVars, loadAppointmentContext } from "@/lib/whatsapp/compose";
import { DERMA, LAMSA, member, patient, reception, RIYADH, riyadhAt, service } from "./fixtures";

afterAll(closeDb);

const DAY = "2036-04-13"; // a Sunday no other test uses
let png: Buffer;
beforeAll(async () => {
  png = await sharp({ create: { width: 400, height: 150, channels: 4, background: "#ffffff" } })
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

const peel = (file: string, time: string) =>
  withActor(reception, (tx) =>
    bookAppointment(tx, reception, {
      branchId: RIYADH,
      patientId: patient(file),
      serviceId: service("chemical_peeling"), // consent needed every visit
      practitionerId: member("derma-dr-sara"),
      startsAt: riyadhAt(time, DAY),
    }),
  );

async function code(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    if (e instanceof ConsentError) return e.code;
    throw e;
  }
  return "ok";
}

describe("consent links", () => {
  it("are signed for one clinic and one visit, and differ from video links", () => {
    const id = "11111111-2222-4333-8444-555555555555";
    expect(parseConsentToken(DERMA, consentToken(DERMA, id))).toBe(id);
    expect(parseConsentToken(LAMSA, consentToken(DERMA, id))).toBeNull();
    expect(parseConsentToken(DERMA, videoToken(DERMA, id))).toBeNull();
  });

  it("the WhatsApp reminder links straight to the consent", async () => {
    const a = await peel("D-0032", "10:00");
    const ctx = await withTenant(DERMA, (tx) => loadAppointmentContext(tx, a.id));
    const vars = appointmentVars(ctx!, "en", "https://clinic.example");
    expect(vars.consent_note).toContain(
      `https://clinic.example/sign/${consentToken(DERMA, a.id)}`,
    );
  });

  it("signs this visit's consent as the patient; once only", async () => {
    const a = await peel("D-0033", "11:00");
    const sign = () =>
      withTenant(DERMA, (tx) =>
        signConsentByLink(tx, {
          tenantId: DERMA,
          appointmentId: a.id,
          signerName: "توقيع تجريبي",
          signaturePng: png,
        }),
      );
    const c = await sign();
    expect(c.appointmentId).toBe(a.id);
    expect(c.signedVia).toBe("patient_portal");
    expect(c.witnessUserId).toBeNull();
    expect(c.templateCode).toBe("chemical_peel");
    expect(await withTenant(DERMA, (tx) => missingConsent(tx, a))).toBeNull();
    expect(await code(sign())).toBe("already_signed");
    const rows = await withTenant(DERMA, (tx) =>
      tx.select().from(patientConsents).where(eq(patientConsents.appointmentId, a.id)),
    );
    expect(rows).toHaveLength(1);
  });

  it("a cancelled visit's link signs nothing", async () => {
    const a = await peel("D-0034", "12:00");
    await withActor(reception, (tx) => changeStatus(tx, reception, a.id, "cancelled"));
    expect(
      await code(
        withTenant(DERMA, (tx) =>
          signConsentByLink(tx, {
            tenantId: DERMA,
            appointmentId: a.id,
            signerName: "اسم",
            signaturePng: png,
          }),
        ),
      ),
    ).toBe("not_found");
  });
});
