import { getTranslations } from "next-intl/server";

export default async function ClinicNotFoundPage() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 p-6 text-center">
      <h1 className="text-2xl font-bold">{t("clinicNotFoundTitle")}</h1>
      <p className="text-muted-foreground">{t("clinicNotFound")}</p>
    </main>
  );
}
