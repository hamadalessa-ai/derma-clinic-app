import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Crown } from "lucide-react";
import { ContactButtons } from "@/components/clinic/contact-buttons";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import type { Locale } from "@/i18n/config";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { atRiyadh, riyadhDay } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { formatGregorian, formatSAR } from "@/lib/format";
import { membershipStats, renewalsDue } from "@/lib/memberships/memberships";

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400_000);

/**
 * Memberships (reception + admin): how many members and the monthly recurring income, who is
 * due for renewal (ending in 14 days, or lapsed in the last 30), and every member today.
 */
export default async function MembershipsPage() {
  const ctx = await requirePermission("memberships:sell");
  const actor = actorOf(ctx);
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("memberships");
  const today = riyadhDay(new Date());
  const { stats, due } = await withActor(actor, async (tx) => ({
    stats: await membershipStats(tx, today),
    due: await renewalsDue(tx, today),
  }));
  const date = (d: string) => formatGregorian(atRiyadh(d, "12:00"), locale, "medium");
  const whatsapp = can(ctx.roles, "whatsapp:inbox");
  const fileLink = (patientId: string) => `/patients/${patientId}?tab=packages`;

  return (
    <div className="flex flex-col gap-4" data-testid="memberships-page">
      <PageHeader title={t("pageTitle")} subtitle={t("pageSubtitle")} />

      <div className="grid gap-3 sm:grid-cols-3">
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4 md:pt-5">
            <span className="text-muted-foreground text-sm">{t("statMembers")}</span>
            <span className="text-2xl font-bold tabular-nums" data-testid="stat-members">
              {stats.members}
            </span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4 md:pt-5">
            <span className="text-muted-foreground text-sm">{t("statMonthly")}</span>
            <span className="text-2xl font-bold tabular-nums" data-testid="stat-monthly" dir="ltr">
              {formatSAR(stats.monthlyHalalas, locale)}
            </span>
            <span className="text-muted-foreground text-xs">{t("statMonthlyHint")}</span>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex flex-col gap-1 pt-4 md:pt-5">
            <span className="text-muted-foreground text-sm">{t("statDue")}</span>
            <span className="text-2xl font-bold tabular-nums" data-testid="stat-due">
              {due.length}
            </span>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("renewalsTitle")}</CardTitle>
          <p className="text-muted-foreground text-sm">{t("renewalsHint")}</p>
        </CardHeader>
        <CardContent>
          {due.length ? (
            <ul className="flex flex-col divide-y rounded-lg border" data-testid="renewals">
              {due.map((r) => {
                const left = daysBetween(today, r.m.endsOn);
                return (
                  <li
                    key={r.m.id}
                    className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2"
                    data-testid="renewal-row"
                    data-patient={r.fileNumber}
                  >
                    <Link href={fileLink(r.m.patientId)} className="min-w-0 flex-1">
                      <span className="font-medium">{pick(locale, r.nameAr, r.nameEn)}</span>
                      <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                        {" "}
                        {r.fileNumber}
                      </span>
                      <span className="text-muted-foreground block text-xs">
                        {pick(locale, r.m.nameAr, r.m.nameEn)} ·{" "}
                        {t("endsOn", { date: date(r.m.endsOn) })}
                      </span>
                    </Link>
                    <Badge variant={left < 0 ? "destructive" : "gold"}>
                      {left < 0
                        ? t("lapsedDays", { n: -left })
                        : left === 0
                          ? t("endsToday")
                          : t("endsInDays", { n: left })}
                    </Badge>
                    <ContactButtons patientId={r.m.patientId} phone={r.phone} whatsapp={whatsapp} />
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={<Crown />} title={t("noRenewals")} />
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("activeTitle", { n: stats.active.length })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          {stats.active.length ? (
            <ul className="flex flex-col divide-y rounded-lg border" data-testid="members">
              {stats.active.map((a) => (
                <li key={a.m.id} className="flex flex-wrap items-center gap-x-3 px-3 py-2 text-sm">
                  <Link href={fileLink(a.m.patientId)} className="min-w-0 flex-1 font-medium">
                    {pick(locale, a.nameAr, a.nameEn)}
                    <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                      {" "}
                      {a.fileNumber}
                    </span>
                  </Link>
                  <span className="text-muted-foreground">
                    {pick(locale, a.m.nameAr, a.m.nameEn)}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {t("endsOn", { date: date(a.m.endsOn) })}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState icon={<Crown />} title={t("noMembers")} />
          )}
        </CardContent>
      </Card>
    </div>
  );
}
