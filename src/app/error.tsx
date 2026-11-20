"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { RotateCcw, TriangleAlert } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * Something broke while showing a page: a calm, branded message instead of a blank screen.
 * Nothing about the error is shown except its reference (to quote to support); the details
 * stay in the server logs (ops alerts).
 */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const t = useTranslations("errors");
  useEffect(() => {
    console.error("page error", error.digest ?? "");
  }, [error]);
  return (
    <main className="bg-background flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <TriangleAlert className="text-warning-foreground size-12" />
      <h1 className="text-2xl font-bold">{t("crashTitle")}</h1>
      <p className="text-muted-foreground max-w-md">{t("crash")}</p>
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => reset()}>
          <RotateCcw />
          {t("tryAgain")}
        </Button>
        <Link href="/" className={buttonVariants({ variant: "outline" })}>
          {t("backStart")}
        </Link>
      </div>
      {error.digest && (
        <p className="text-muted-foreground text-xs" dir="ltr">
          {t("reference")}: {error.digest}
        </p>
      )}
    </main>
  );
}
