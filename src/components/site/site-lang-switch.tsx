"use client";

import { useTransition } from "react";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { setLocale } from "@/app/actions/locale";
import { cn } from "@/lib/utils";

/** Strict EN | AR switch for the clinic website (the page flips LTR / RTL with it). */
export function SiteLangSwitch({ className }: { className?: string }) {
  const locale = useLocale();
  const router = useRouter();
  const [pending, start] = useTransition();
  const go = (l: "en" | "ar") =>
    l !== locale &&
    start(async () => {
      await setLocale(l);
      router.refresh();
    });
  return (
    <div
      className={cn(
        "flex items-center rounded-full border border-current/25 p-0.5 text-[11px]",
        className,
      )}
      role="group"
      aria-label="Language / اللغة"
      data-testid="site-lang"
    >
      {(["en", "ar"] as const).map((l) => (
        <button
          key={l}
          type="button"
          lang={l}
          disabled={pending}
          aria-pressed={locale === l}
          onClick={() => go(l)}
          className={cn(
            "rounded-full px-2.5 py-0.5 font-semibold tracking-wide transition-colors",
            locale === l ? "bg-site-ivory text-site-night" : "opacity-80 hover:opacity-100",
          )}
        >
          {l === "en" ? "EN" : "عربي"}
        </button>
      ))}
    </div>
  );
}
