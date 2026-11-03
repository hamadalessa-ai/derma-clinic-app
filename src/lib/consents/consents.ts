/**
 * Consents. The OFFICIAL record is the patient_consents row: it stores a snapshot of the
 * exact template text (Arabic + English), the template version, a sha256 fingerprint of
 * that text, the signature image, the signer, the witnessing staff member and the time.
 * PDFs and print pages are just views of this record.
 */
import { and, asc, desc, eq, inArray, or } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import {
  appointments,
  consentRules,
  consentTemplates,
  packageSessionEvents,
  patientConsents,
  patientPackages,
  patients,
  services,
  type ConsentRule,
} from "@/db/schema";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { getFileStore } from "@/lib/files/store";
import { contentFingerprint } from "./fingerprint";
import { decideConsent, type ConsentReason } from "./rules";

export { contentFingerprint };

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
 * Which consent (if any) this appointment still needs signed, by the template's renewal rule
 * (src/lib/consents/rules.ts). Only the CURRENT template version counts.
 */
export async function missingConsent(
  tx: TenantTx,
  appt: { id: string; patientId: string; serviceId: string },
) {
  const status = (await consentStatusFor(tx, [appt])).get(appt.id);
  if (!status || status.signed) return null;
  const [tpl] = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.id, status.templateId));
  return tpl ?? null;
}

/** Each template code's renewal rule (no row = every visit). */
export async function consentRulesByCode(tx: TenantTx) {
  const rows = await tx.select().from(consentRules);
  return new Map(rows.map((r) => [r.code, { rule: r.rule, months: r.months }]));
}

/** Admin: sets when a consent needs a new signature. */
export async function saveConsentRule(
  tx: TenantTx,
  actor: Actor,
  input: { code: string; rule: ConsentRule; months: number | null },
) {
  assertCan(actor.roles, "consents:templates");
  if (!(await currentTemplate(tx, input.code))) throw new ConsentError("not_found");
  const months = input.rule === "months" ? Math.min(120, Math.max(1, input.months ?? 12)) : null;
  await tx
    .insert(consentRules)
    .values({
      tenantId: actor.tenantId,
      code: input.code,
      rule: input.rule,
      months,
      updatedBy: actor.userId,
    })
    .onConflictDoUpdate({
      target: [consentRules.tenantId, consentRules.code],
      set: { rule: input.rule, months, updatedBy: actor.userId, updatedAt: new Date() },
    });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "consent_rule.set",
    entityType: "consent_rule",
    entityId: input.code,
    metadata: { rule: input.rule, months },
  });
}

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

interface SignInput {
  patientId: string;
  templateId: string;
  signerName: string;
  signerRelation: "self" | "guardian";
  signaturePng: Buffer;
  appointmentId?: string | null;
  userAgent?: string | null;
}

/** At the clinic: signed on the reception tablet, witnessed by the staff member. */
export async function signConsent(tx: TenantTx, actor: Actor, input: SignInput) {
  assertCan(actor.roles, "consents:collect");
  return storeSignedConsent(tx, actor.tenantId, { witnessUserId: actor.userId }, input);
}

/**
 * On the patient page (/my), before the visit: the signed-in patient signs for themselves or a
 * child they are guardian of. No clinic witness; the record says "signed on the patient page".
 * Runs in a clinic transaction without a staff user (patients can't write directly).
 */
export async function signConsentByPatient(
  tx: TenantTx,
  input: Omit<SignInput, "signerRelation"> & { tenantId: string; sessionPatientId: string },
) {
  const family = await tx
    .select({ id: patients.id })
    .from(patients)
    .where(
      or(eq(patients.id, input.sessionPatientId), eq(patients.guardianId, input.sessionPatientId)),
    );
  if (!family.some((p) => p.id === input.patientId)) throw new ConsentError("not_found");
  return storeSignedConsent(
    tx,
    input.tenantId,
    { witnessUserId: null, viaPatient: input.sessionPatientId },
    {
      ...input,
      signerRelation: input.patientId === input.sessionPatientId ? "self" : "guardian",
    },
  );
}

const PNG_MAGIC_CHECK = (png: Buffer) => png.length >= 100 && png.subarray(0, 4).equals(PNG_MAGIC);

async function storeSignedConsent(
  tx: TenantTx,
  tenantId: string,
  by: { witnessUserId: string | null; viaPatient?: string },
  input: SignInput,
) {
  const signerName = input.signerName.trim();
  if (signerName.length < 2) throw new ConsentError("signer_required");
  if (!PNG_MAGIC_CHECK(input.signaturePng)) throw new ConsentError("bad_signature");
  const [tpl] = await tx
    .select()
    .from(consentTemplates)
    .where(eq(consentTemplates.id, input.templateId))
    .limit(1);
  if (!tpl) throw new ConsentError("not_found");
  if (!tpl.isCurrent) throw new ConsentError("not_current");
  // A signature "for this visit" must be for one of this patient's own appointments.
  if (input.appointmentId) {
    const [appt] = await tx
      .select({ patientId: appointments.patientId })
      .from(appointments)
      .where(eq(appointments.id, input.appointmentId));
    if (appt?.patientId !== input.patientId) throw new ConsentError("not_found");
  }

  const file = await getFileStore().put(
    { tx, tenantId, userId: by.witnessUserId },
    { kind: "signature", mimeType: "image/png", data: input.signaturePng },
  );
  const [consent] = await tx
    .insert(patientConsents)
    .values({
      tenantId,
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
      witnessUserId: by.witnessUserId,
      signedVia: by.viaPatient ? "patient_portal" : "clinic",
      appointmentId: input.appointmentId ?? null,
      userAgent: input.userAgent?.slice(0, 300) ?? null,
    })
    .returning();
  await audit(tx, {
    actorUserId: by.witnessUserId,
    action: "consent.sign",
    entityType: "patient_consent",
    entityId: consent.id,
    metadata: {
      patientId: input.patientId,
      code: tpl.code,
      version: tpl.version,
      appointmentId: input.appointmentId ?? null,
      ...(by.viaPatient ? { via: "patient_page", signedInPatientId: by.viaPatient } : {}),
    },
  });
  return consent;
}

export interface ConsentStatus {
  templateId: string;
  code: string;
  signed: boolean;
  signedVia: string | null;
  rule: ConsentRule;
  months: number | null;
  reason: ConsentReason;
}

/**
 * For each appointment: which consent its service needs, whether it is signed FOR THIS VISIT by
 * the template's renewal rule, and why (shown on the appointment).
 */
export async function consentStatusFor(
  tx: TenantTx,
  appts: { id: string; patientId: string; serviceId: string }[],
  now = new Date(),
) {
  const out = new Map<string, ConsentStatus>();
  if (!appts.length) return out;
  const svc = await tx
    .select({ id: services.id, consentCode: services.consentCode })
    .from(services)
    .where(inArray(services.id, [...new Set(appts.map((a) => a.serviceId))]));
  const codes = [...new Set(svc.map((s) => s.consentCode).filter((c): c is string => !!c))];
  if (!codes.length) return out;
  const patientIds = [...new Set(appts.map((a) => a.patientId))];
  const [tpls, rules, signatures, times, pkgs, deductions] = await Promise.all([
    tx
      .select()
      .from(consentTemplates)
      .where(and(eq(consentTemplates.isCurrent, true), inArray(consentTemplates.code, codes))),
    consentRulesByCode(tx),
    tx
      .select({
        patientId: patientConsents.patientId,
        templateId: patientConsents.templateId,
        templateCode: patientConsents.templateCode,
        appointmentId: patientConsents.appointmentId,
        signedAt: patientConsents.signedAt,
        signedVia: patientConsents.signedVia,
      })
      .from(patientConsents)
      .where(
        and(
          inArray(patientConsents.patientId, patientIds),
          inArray(patientConsents.templateCode, codes),
        ),
      ),
    tx
      .select({ id: appointments.id, startsAt: appointments.startsAt })
      .from(appointments)
      .where(
        inArray(
          appointments.id,
          appts.map((a) => a.id),
        ),
      ),
    tx.select().from(patientPackages).where(inArray(patientPackages.patientId, patientIds)),
    // Patients can't read balance changes (patient wall): then the active package is used.
    tx
      .select({
        appointmentId: packageSessionEvents.appointmentId,
        packageId: packageSessionEvents.patientPackageId,
      })
      .from(packageSessionEvents)
      .where(
        and(
          eq(packageSessionEvents.kind, "deduction"),
          inArray(
            packageSessionEvents.appointmentId,
            appts.map((a) => a.id),
          ),
        ),
      ),
  ]);
  for (const a of appts) {
    const code = svc.find((s) => s.id === a.serviceId)?.consentCode;
    const tpl = code ? tpls.find((t) => t.code === code) : undefined;
    if (!tpl) continue;
    const startsAt = times.find((t) => t.id === a.id)?.startsAt ?? now;
    // The package this visit uses: the one deducted at check-in, else the one check-in would use.
    const deducted = deductions.find((d) => d.appointmentId === a.id);
    const pkg = deducted
      ? pkgs.find((p) => p.id === deducted.packageId)
      : pkgs
          .filter(
            (p) =>
              p.patientId === a.patientId &&
              p.serviceId === a.serviceId &&
              p.sessionsUsed < p.sessionsTotal &&
              p.expiresAt > now,
          )
          .sort((x, y) => x.expiresAt.getTime() - y.expiresAt.getTime())[0];
    const rule = rules.get(tpl.code) ?? { rule: "every_visit" as const, months: null };
    const decision = decideConsent({
      rule: rule.rule,
      months: rule.months,
      currentTemplateId: tpl.id,
      appointment: { id: a.id, startsAt },
      pkg: pkg ? { purchasedAt: pkg.purchasedAt } : null,
      signatures: signatures.filter(
        (x) => x.patientId === a.patientId && x.templateCode === tpl.code,
      ),
    });
    out.set(a.id, {
      templateId: tpl.id,
      code: tpl.code,
      signed: decision.signed,
      signedVia: decision.signature?.signedVia ?? null,
      rule: decision.rule,
      months: decision.months,
      reason: decision.reason,
    });
  }
  return out;
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
