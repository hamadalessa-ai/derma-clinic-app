import { getLocale, getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/language-toggle";
import { formatDualDate, formatSAR } from "@/lib/format";
import type { Locale } from "@/i18n/config";

// Temporary placeholder page; replaced by the dashboard in a later step.
export default async function Home() {
  const t = await getTranslations("app");
  const locale = (await getLocale()) as Locale;
  return (
    <main className="mx-auto flex max-w-xl flex-col gap-4 p-10">
      <LanguageToggle />
      <h1 className="text-brand text-2xl font-bold">{t("name")}</h1>
      <p>{t("demoBanner")}</p>
      <p>{formatDualDate(new Date(), locale)}</p>
      <p>{formatSAR(125000, locale)}</p>
    </main>
  );
}
