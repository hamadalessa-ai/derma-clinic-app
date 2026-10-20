import { getTranslations } from "next-intl/server";

export async function DemoBanner() {
  const t = await getTranslations("app");
  return (
    <div className="bg-warning text-warning-foreground px-4 py-1.5 text-center text-xs font-medium">
      {t("demoBanner")}
    </div>
  );
}
