"use client";

import { useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { Languages } from "lucide-react";
import { setLocale } from "@/app/actions/locale";
import { Button } from "@/components/ui/button";

export function LanguageToggle() {
  const t = useTranslations("app");
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <Button
      variant="outline"
      size="sm"
      aria-label={t("languageLabel")}
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await setLocale(locale === "ar" ? "en" : "ar");
          router.refresh();
        })
      }
    >
      <Languages />
      {t("language")}
    </Button>
  );
}
