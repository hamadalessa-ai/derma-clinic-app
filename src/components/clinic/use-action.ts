"use client";

import { useCallback, useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Runs a server action, keeps "pending" and a translated error message, refreshes the page on success. */
export function useAction() {
  const t = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(
    <T>(action: () => Promise<Result<T>>, onSuccess?: (data: T) => void) => {
      setError(null);
      start(async () => {
        const r = await action();
        if (!r.ok) {
          setError(t.has(r.error) ? t(r.error) : t("unexpected"));
          return;
        }
        onSuccess?.(r.data);
        router.refresh();
      });
    },
    [router, t],
  );
  return { run, pending, error, setError };
}
