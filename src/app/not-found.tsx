import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { SearchX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

/** Any address that doesn't exist (or a link that is no longer valid): calm, branded, a way back. */
export default async function NotFound() {
  const t = await getTranslations("errors");
  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <SearchX className="text-brand-strong size-12" />
      <h1 className="text-2xl font-bold">{t("notFoundTitle")}</h1>
      <p className="text-muted-foreground max-w-md">{t("notFound")}</p>
      <Link href="/" className={buttonVariants({ variant: "outline" })}>
        {t("backStart")}
      </Link>
    </main>
  );
}
