import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ShieldX } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";

export default async function ForbiddenPage() {
  const t = await getTranslations("errors");
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <ShieldX className="text-destructive size-12" />
      <h1 className="text-2xl font-bold">{t("forbiddenTitle")}</h1>
      <p className="text-muted-foreground">{t("forbidden")}</p>
      <Link href="/home" className={buttonVariants({ variant: "outline" })}>
        {t("backHome")}
      </Link>
    </main>
  );
}
