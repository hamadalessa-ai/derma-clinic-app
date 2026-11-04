import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { HoursExceptions, WeeklyHoursEditor } from "@/components/clinic/working-hours";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { riyadhDay } from "@/lib/booking/time";
import { editableDoctors, loadWorkingHours } from "@/lib/booking/working-hours";
import { pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Locale } from "@/i18n/config";

/**
 * Working hours: each doctor's weekly pattern (shifts per day, at a branch) and one-off changes
 * for single dates. Admins see every doctor, reception their branch's doctors, a doctor themself.
 */
export default async function WorkingHoursPage({
  searchParams,
}: {
  searchParams: Promise<{ doctor?: string }>;
}) {
  const ctx = await requirePermission("hours:edit");
  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("hours");
  const actor = actorOf(ctx);

  const doctors = await withActor(actor, (tx) => editableDoctors(tx, actor));
  if (!doctors.length) {
    return (
      <div className="flex max-w-3xl flex-col gap-4">
        <PageHeader title={t("title")} />
        <Notice tone="info">{t("notAllowed")}</Notice>
      </div>
    );
  }
  const selected =
    doctors.find((d) => d.id === sp.doctor) ??
    doctors.find((d) => d.id === ctx.memberId) ??
    doctors[0];
  const data = await withActor(actor, (tx) => loadWorkingHours(tx, actor, selected.id));
  const today = riyadhDay(new Date());

  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {doctors.length > 1 && (
        <div className="flex flex-wrap gap-2" data-testid="hours-doctors">
          {doctors.map((d) => (
            <Link
              key={d.id}
              href={`/working-hours?doctor=${d.id}`}
              className={cn(
                "rounded-full border px-3 py-1 text-sm",
                d.id === selected.id
                  ? "bg-brand text-brand-foreground border-brand"
                  : "bg-card hover:bg-accent",
              )}
            >
              {pick(locale, d.nameAr, d.nameEn)}
            </Link>
          ))}
        </div>
      )}

      {data.conflicts.length > 0 && (
        <Notice tone="warning" className="flex flex-col gap-2" data-testid="hours-conflicts">
          <span className="font-medium">{t("conflicts", { count: data.conflicts.length })}</span>
          <ul className="flex flex-col gap-1">
            {data.conflicts.slice(0, 20).map((c) => (
              <li key={c.id}>
                <Link
                  href={`/calendar?date=${riyadhDay(new Date(c.startsAt))}`}
                  className="underline"
                >
                  {formatGregorian(new Date(c.startsAt), locale, "medium")} ·{" "}
                  {formatTime(new Date(c.startsAt), locale)} ·{" "}
                  {pick(locale, c.patientAr, c.patientEn)} ·{" "}
                  {pick(locale, c.serviceAr, c.serviceEn)}
                </Link>
              </li>
            ))}
          </ul>
          <span className="text-xs">{t("conflictsHint")}</span>
        </Notice>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {t("weekly", { name: pick(locale, selected.nameAr, selected.nameEn) })}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <WeeklyHoursEditor
            key={selected.id}
            memberId={selected.id}
            branches={data.branches}
            initial={data.weekly}
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t("changes")}</CardTitle>
        </CardHeader>
        <CardContent>
          <HoursExceptions
            key={selected.id}
            memberId={selected.id}
            branches={data.branches}
            exceptions={data.exceptions}
            today={today}
          />
        </CardContent>
      </Card>
    </div>
  );
}
