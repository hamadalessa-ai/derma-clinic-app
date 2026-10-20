/**
 * Consents. The OFFICIAL record is the patient_consents row: it stores a snapshot of the
 * exact template text (Arabic + English), the template version, a sha256 fingerprint of
 * that text, the signature image, the signer, the witnessing staff member and the time.
 * PDFs and print pages are just views of this record.
 */
import { createHash } from "node:crypto";
import { and, asc, desc, eq } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { consentTemplates, patientConsents, services } from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { getFileStore } from "@/lib/files/store";

export type ConsentTemplate = typeof consentTemplates.$inferSelect;
export type PatientConsent = typeof patientConsents.$inferSelect;

export class ConsentError extends Error {
  constructor(
    public code: "not_found" | "not_current" | "bad_signature" | "signer_required" | "empty_text",
  ) {
    super(code);
    this.name = "ConsentError";
  }
}

export function contentFingerprint(t: {
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify([t.titleAr, t.titleEn, t.bodyAr, t.bodyEn]))
    .digest("hex");
}

export async function currentTemplates(tx: TenantTx) {
  return tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.isCurrent, true))
    .orderBy(asc(consentTemplates.code));
}

export async function currentTemplate(tx: TenantTx, code: string) {
  const [t] = await tx
    .select()
    .from(consentTemplates)
    .where(and(eq(consentTemplates.code, code), eq(consentTemplates.isCurrent, true)))
    .limit(1);
  return t ?? null;
}

export async function templateVersions(tx: TenantTx, code: string) {
  return tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.code, code))
    .orderBy(desc(consentTemplates.version));
}

/** Editing a template never changes old versions: it creates version N+1 and makes it current. */
export async function saveTemplateVersion(
  tx: TenantTx,
  actor: Actor,
  code: string,
  text: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string },
) {
  assertCan(actor.roles, "consents:templates");
  const clean = {
    titleAr: text.titleAr.trim(),
    titleEn: text.titleEn.trim(),
    bodyAr: text.bodyAr.trim(),
    bodyEn: text.bodyEn.trim(),
  };
  if (Object.values(clean).some((v) => !v)) throw new ConsentError("empty_text");
  const versions = await templateVersions(tx, code);
  const latest = versions[0];
  if (!latest) throw new ConsentError("not_found");
  await tx
    .update(consentTemplates)
    .set({ isCurrent: false })
    .where(and(eq(consentTemplates.code, code), eq(consentTemplates.isCurrent, true)));
  const [created] = await tx
    .insert(consentTemplates)
    .values({
      tenantId: actor.tenantId,
      code,
      version: latest.version + 1,
      isCurrent: true,
      ...clean,
      createdBy: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "consent_template.new_version",
    entityType: "consent_template",
    entityId: created.id,
    metadata: { code, version: created.version },
  });
  return created;
}

/**
 * Which consent (if any) this patient still has to sign for a service.
 * A signature counts only for the CURRENT version of the template.
 */
export async function missingConsent(tx: TenantTx, patientId: string, serviceId: string) {
  const [svc] = await tx.select().from(services).where(eq(services.id, serviceId)).limit(1);
  if (!svc?.consentCode) return null;
  const tpl = await currentTemplate(tx, svc.consentCode);
  if (!tpl) return null;
  const [signed] = await tx
    .select({ id: patientConsents.id })
    .from(patientConsents)
    .where(and(eq(patientConsents.patientId, patientId), eq(patientConsents.templateId, tpl.id)))
    .limit(1);
  return signed ? null : tpl;
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

export async function signConsent(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    templateId: string;
    signerName: string;
    signerRelation: "self" | "guardian";
    signaturePng: Buffer;
    appointmentId?: string | null;
    userAgent?: string | null;
  },
) {
  assertCan(actor.roles, "consents:collect");
  const signerName = input.signerName.trim();
  if (signerName.length < 2) throw new ConsentError("signer_required");
  if (input.signaturePng.length < 100 || !input.signaturePng.subarray(0, 4).equals(PNG_MAGIC)) {
    throw new ConsentError("bad_signature");
  }
  const [tpl] = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.id, input.templateId))
    .limit(1);
  if (!tpl) throw new ConsentError("not_found");
  if (!tpl.isCurrent) throw new ConsentError("not_current");

  const file = await getFileStore().put(
    { tx, tenantId: actor.tenantId, userId: actor.userId },
    { kind: "signature", mimeType: "image/png", data: input.signaturePng },
  );
  const [consent] = await tx
    .insert(patientConsents)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      templateId: tpl.id,
      templateCode: tpl.code,
      templateVersion: tpl.version,
      titleAr: tpl.titleAr,
      titleEn: tpl.titleEn,
      bodyAr: tpl.bodyAr,
      bodyEn: tpl.bodyEn,
      contentSha256: contentFingerprint(tpl),
      signerName,
      signerRelation: input.signerRelation,
      signatureFileId: file.id,
      witnessUserId: actor.userId,
      appointmentId: input.appointmentId ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "consent.sign",
    entityType: "patient_consent",
    entityId: consent.id,
    metadata: {
      patientId: input.patientId,
      code: tpl.code,
      version: tpl.version,
      appointmentId: input.appointmentId ?? null,
    },
  });
  return consent;
}

export async function consentsForPatient(tx: TenantTx, patientId: string) {
  return tx
    .select()
    .from(patientConsents)
    .where(eq(patientConsents.patientId, patientId))
    .orderBy(desc(patientConsents.signedAt));
}

export async function getConsent(tx: TenantTx, id: string) {
  const [c] = await tx.select().from(patientConsents).where(eq(patientConsents.id, id)).limit(1);
  return c ?? null;
}

/** True when the stored snapshot still matches its fingerprint (nothing was altered). */
export function isIntact(c: PatientConsent) {
  return contentFingerprint(c) === c.contentSha256;
}
