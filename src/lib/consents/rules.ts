/**
 * Consent renewal rules: does THIS appointment need a new signature? One pure function, used by
 * check-in, the patient page (/my), the calendar and WhatsApp reminders alike.
 *
 *  - every_visit      a signature made for this appointment (default);
 *  - per_package      signed after the package this visit uses was bought (no package → every visit);
 *  - months           signed within N months before the visit;
 *  - template_change  any signature of the current version.
 * Always: only a signature of the CURRENT template version counts (new text → new signature).
 */
import type { ConsentRule } from "@/db/schema";

export type { ConsentRule };

export interface Signature {
  templateId: string;
  appointmentId: string | null;
  signedAt: Date;
  signedVia: string;
}

export type ConsentReason =
  | { code: "signed_this_visit"; signedAt: Date }
  | { code: "signed_this_package"; signedAt: Date }
  | { code: "signed_within"; signedAt: Date; validUntil: Date }
  | { code: "signed_current_version"; signedAt: Date }
  | { code: "never_signed" }
  | { code: "text_changed"; signedAt: Date }
  | { code: "previous_visit"; signedAt: Date }
  | { code: "before_package"; signedAt: Date }
  | { code: "expired"; signedAt: Date; validUntil: Date };

export interface ConsentDecision {
  signed: boolean;
  /** The rule actually applied ("per_package" without a package falls back to "every_visit"). */
  rule: ConsentRule;
  months: number | null;
  reason: ConsentReason;
  /** The signature that counts (when signed). */
  signature: Signature | null;
}

/** Adds calendar months (31 Jan + 1 month = 28/29 Feb, never 3 March). */
export function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + months);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d;
}

export function decideConsent(input: {
  rule: ConsentRule;
  months: number | null;
  currentTemplateId: string;
  appointment: { id: string; startsAt: Date };
  /** The package this visit uses (deducted at check-in, or the one check-in would use). */
  pkg: { purchasedAt: Date } | null;
  /** All of this patient's signatures for this consent (any version). */
  signatures: Signature[];
}): ConsentDecision {
  const rule: ConsentRule = input.rule === "per_package" && !input.pkg ? "every_visit" : input.rule;
  const months = rule === "months" ? (input.months ?? 12) : null;
  const newestFirst = [...input.signatures].sort(
    (a, b) => b.signedAt.getTime() - a.signedAt.getTime(),
  );
  const current = newestFirst.filter((s) => s.templateId === input.currentTemplateId);
  const base = { rule, months };
  const yes = (signature: Signature, reason: ConsentReason): ConsentDecision => ({
    ...base,
    signed: true,
    reason,
    signature,
  });
  const no = (reason: ConsentReason): ConsentDecision => ({
    ...base,
    signed: false,
    reason,
    signature: null,
  });

  if (!current.length) {
    return newestFirst.length
      ? no({ code: "text_changed", signedAt: newestFirst[0].signedAt })
      : no({ code: "never_signed" });
  }
  const latest = current[0];
  switch (rule) {
    case "every_visit": {
      const hit = current.find((s) => s.appointmentId === input.appointment.id);
      return hit
        ? yes(hit, { code: "signed_this_visit", signedAt: hit.signedAt })
        : no({ code: "previous_visit", signedAt: latest.signedAt });
    }
    case "per_package": {
      const hit = current.find((s) => s.signedAt >= input.pkg!.purchasedAt);
      return hit
        ? yes(hit, { code: "signed_this_package", signedAt: hit.signedAt })
        : no({ code: "before_package", signedAt: latest.signedAt });
    }
    case "months": {
      const validUntil = addMonths(latest.signedAt, months!);
      return input.appointment.startsAt <= validUntil
        ? yes(latest, { code: "signed_within", signedAt: latest.signedAt, validUntil })
        : no({ code: "expired", signedAt: latest.signedAt, validUntil });
    }
    case "template_change":
      return yes(latest, { code: "signed_current_version", signedAt: latest.signedAt });
  }
}

/** What a screen needs to explain the decision (dates as ISO strings). */
export interface ConsentReasonView {
  code: ConsentReason["code"];
  rule: ConsentRule;
  months: number | null;
  signedAt: string | null;
  validUntil: string | null;
  viaPatientPage: boolean;
}

export function reasonView(s: {
  rule: ConsentRule;
  months: number | null;
  reason: ConsentReason;
  signedVia: string | null;
}): ConsentReasonView {
  const r = s.reason;
  return {
    code: r.code,
    rule: s.rule,
    months: s.months,
    signedAt: "signedAt" in r ? r.signedAt.toISOString() : null,
    validUntil: "validUntil" in r ? r.validUntil.toISOString() : null,
    viaPatientPage: s.signedVia === "patient_portal",
  };
}
