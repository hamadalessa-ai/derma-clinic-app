"use client";

import { useTranslations } from "next-intl";

/**
 * Shown when the AI scribe wrote into this note: the doctor (or the nurse posting in his name)
 * ticks that they checked it before it can be signed or posted. The server checks it too.
 */
export function AiReviewTick({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  const t = useTranslations("scribe");
  return (
    <label className="bg-muted flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-4 shrink-0"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        data-testid="ai-reviewed"
      />
      {t("reviewedTick")}
    </label>
  );
}
