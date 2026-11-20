import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import type { Locale } from "@/i18n/config";
import { can } from "@/lib/auth/permissions";
import { requirePermission } from "@/lib/auth/session";
import { HELP_GUIDES, HELP_ROLES, helpRoleFor, type HelpRole } from "@/lib/help/guides";
import { cn } from "@/lib/utils";

/** Help centre: short step-by-step guides per role; opens on the reader's own role. */
export default async function HelpPage({
  searchParams,
}: {
  searchParams: Promise<{ role?: string }>;
}) {
  const ctx = await requirePermission("help:view");
  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("help");
  const tr = await getTranslations("roles");
  const role: HelpRole = (HELP_ROLES as readonly string[]).includes(sp.role ?? "")
    ? (sp.role as HelpRole)
    : helpRoleFor(ctx.roles);
  const en = locale === "en";
  const Arrow = en ? ArrowRight : ArrowLeft;

  return (
    <div className="flex flex-col gap-4" data-testid="help-centre">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <nav className="flex flex-wrap items-center gap-2" aria-label={t("forRole")}>
        <span className="text-muted-foreground text-sm">{t("forRole")}</span>
        {HELP_ROLES.map((r) => (
          <Link
            key={r}
            href={`/help?role=${r}`}
            className={cn(
              buttonVariants({ size: "sm", variant: r === role ? "default" : "outline" }),
            )}
            aria-current={r === role ? "page" : undefined}
            data-testid="help-role"
          >
            {tr(r)}
          </Link>
        ))}
      </nav>
      <div className="grid gap-4 lg:grid-cols-2">
        {HELP_GUIDES[role].map((g) => (
          <Card key={g.id} data-testid="help-guide" id={g.id}>
            <CardHeader>
              <CardTitle className="text-base">{en ? g.titleEn : g.titleAr}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <ol className="flex flex-col gap-2">
                {g.steps.map((step, i) => (
                  <li key={i} className="flex gap-3 text-sm leading-6">
                    <span className="bg-brand-soft text-brand-strong flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold">
                      {i + 1}
                    </span>
                    <span>{en ? step.en : step.ar}</span>
                  </li>
                ))}
              </ol>
              {g.link && can(ctx.roles, g.link.permission) && (
                <Link
                  href={g.link.href}
                  className={cn(buttonVariants({ size: "sm", variant: "outline" }), "self-start")}
                >
                  {t("open")}
                  <Arrow />
                </Link>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      <p className="text-muted-foreground text-sm">{t("more")}</p>
    </div>
  );
}
