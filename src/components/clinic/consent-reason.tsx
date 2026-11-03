"use client";

import { useLocale, useTranslations } from "next-intl";
import { riyadhParts } from "@/components/clinic/time";
import type { ConsentReasonView } from "@/lib/consents/rules";
import { formatGregorian } from "@/lib/format";
import type { Locale } from "@/i18n/config";

/** Whole Riyadh days between two moments ("today" = 0). */
function daysBetween(fromIso: string, to = new Date()) {
  const a = Date.parse(`${riyadhParts(fromIso).day}T00:00:00Z`);
  const b = Date.parse(`${riyadhParts(to.toISOString()).day}T00:00:00Z`);
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

/**
 * One plain sentence: why this appointment does or doesn't need a signature, e.g.
 * "Signed 3 days ago, valid for this package" / "New signature needed: signed for a previous visit".
 */
export function useConsentReason() {
  const t = useTranslations("consentReason");
  const locale = useLocale();
  return (r: ConsentReasonView) => {
    const ago = r.signedAt ? t("ago", { days: daysBetween(r.signedAt) }) : "";
    const date = (iso: string | null) =>
      iso ? formatGregorian(new Date(iso), locale as Locale, "medium") : "";
    const text = t(r.code, { ago, months: r.months ?? 0, until: date(r.validUntil) });
    return r.viaPatientPage && r.signedAt ? `${text} · ${t("onPatientPage")}` : text;
  };
}

export function ConsentReason({ reason }: { reason: ConsentReasonView }) {
  const say = useConsentReason();
  return (
    <span data-testid="consent-reason" data-code={reason.code}>
      {say(reason)}
    </span>
  );
}
