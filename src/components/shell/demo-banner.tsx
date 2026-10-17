import { getTranslations } from "next-intl/server";

export async function DemoBanner() {
  const t = await getTranslations("app");
  return (
    <div className="bg-amber-100 px-4 py-1.5 text-center text-xs font-medium text-amber-900">
      {t("demoBanner")}
    </div>
  );
}
