import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChartColumn, ChevronLeft, ChevronRight, Download } from "lucide-react";
import { buttonVariants, Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { Locale } from "@/i18n/config";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { isDay, riyadhDay } from "@/lib/booking/time";
import { membershipStats } from "@/lib/memberships/memberships";
import { formatSAR } from "@/lib/format";
import {
  isMonth,
  ownerReport,
  reportBranches,
  shiftMonth,
  thisMonth,
  type Totals,
} from "@/lib/reports/owner";

/** Reports for the clinic owner: one month, all branches or one. */
export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; branch?: string; day?: string }>;
}) {
  const ctx = await requirePermission("reports:view");
  const t = await getTranslations("reports");
  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;
  const month = isMonth(sp.month) ? sp.month : thisMonth();
  const actor = actorOf(ctx);
  const { report, branches, members } = await withActor(actor, async (tx) => {
    const branches = await reportBranches(tx);
    const branchId = branches.some((b) => b.id === sp.branch) ? sp.branch! : null;
    return {
      branches,
      report: await ownerReport(tx, actor, month, branchId),
      members: await membershipStats(tx),
    };
  });
  const name = (x: { nameAr: string; nameEn: string }) => (locale === "ar" ? x.nameAr : x.nameEn);
  const sar = (h: number) => formatSAR(h, locale);
  const monthLabel = new Intl.DateTimeFormat(
    locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA",
    {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    },
  ).format(new Date(`${month}-15T00:00:00Z`));
  const href = (m: string) =>
    `/reports?month=${m}${report.branchId ? `&branch=${report.branchId}` : ""}`;
  const { totals: now, previous: before } = report;
  const allBranches = !report.branchId;
  const online = now.bySource.online + now.bySource.whatsapp;
  const maxDay = Math.max(1, ...report.byDay.map((d) => d.bookings));
  const today = riyadhDay(new Date());
  const day = isDay(sp.day) ? sp.day : today;
  const Prev = locale === "ar" ? ChevronRight : ChevronLeft;
  const Next = locale === "ar" ? ChevronLeft : ChevronRight;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />

      <div className="flex flex-wrap items-center gap-2">
        <Link
          href={href(shiftMonth(month, -1))}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("prev")}
        >
          <Prev />
        </Link>
        <span className="min-w-36 text-center font-semibold" data-testid="report-month">
          {monthLabel}
        </span>
        <Link
          href={href(shiftMonth(month, 1))}
          className={buttonVariants({ variant: "outline", size: "sm" })}
          aria-label={t("next")}
        >
          <Next />
        </Link>
        {branches.length > 1 && (
          <form className="ms-auto flex items-center gap-2" action="/reports">
            <input type="hidden" name="month" value={month} />
            <Select
              name="branch"
              defaultValue={report.branchId ?? ""}
              aria-label={t("branch")}
              className="w-48"
            >
              <option value="">{t("allBranches")}</option>
              {branches.map((b) => (
                <option key={b.id} value={b.id}>
                  {name(b)}
                </option>
              ))}
            </Select>
            <Button type="submit" variant="outline" size="sm">
              {t("show")}
            </Button>
          </form>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" data-testid="report-tiles">
        <Tile label={t("bookings")} value={now.bookings} change={change(now, before, "bookings")} />
        <Tile
          label={t("completed")}
          value={now.completed}
          change={change(now, before, "completed")}
        />
        <Tile
          label={t("noShowRate")}
          value={`${now.noShowRate}%`}
          hint={t("noShows", { n: now.noShow })}
          change={now.noShowRate - before.noShowRate}
          lowerIsBetter
        />
        <Tile
          label={t("onlineShare")}
          value={`${now.bookings ? Math.round((online / now.bookings) * 100) : 0}%`}
          hint={t("onlineCount", { n: online })}
        />
        <Tile
          label={t("visitValue")}
          value={sar(now.visitValue)}
          hint={t("visitValueHint")}
          change={change(now, before, "visitValue")}
        />
        {allBranches && (
          <>
            <Tile
              label={t("packagesSold")}
              value={now.packagesSold}
              hint={sar(now.packagesValue)}
              change={change(now, before, "packagesSold")}

              gold
            />
            <Tile
              label={t("packagePayments")}
              value={sar(now.packagePayments)}
              hint={t("packageVisits", { n: now.packageVisits })}
              gold
            />
            <Tile
              label={t("newPatients")}
              value={now.newPatients}
              change={change(now, before, "newPatients")}
            />
            <Tile
              label={t("members")}
              value={members.members}
              hint={t("membersMonthly", { amount: sar(members.monthlyHalalas) })}
              gold
            />
          </>
        )}
      </div>
      {!allBranches && <p className="text-muted-foreground text-xs">{t("clinicWideNote")}</p>}

      {now.bookings === 0 && now.cancelled === 0 ? (
        <EmptyState icon={<ChartColumn />} title={t("empty")} />
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t("perDay")}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex h-32 items-end gap-0.5" role="img" aria-label={t("perDay")}>
                {report.byDay.map((d) => (
                  <div
                    key={d.day}
                    title={`${d.day}: ${d.bookings}`}
                    className={
                      d.day === today
                        ? "bg-brand-strong flex-1 rounded-t-sm"
                        : "bg-brand/60 flex-1 rounded-t-sm"
                    }
                    style={{ height: `${Math.max(2, (d.bookings / maxDay) * 100)}%` }}
                  />
                ))}
              </div>
              <div className="text-muted-foreground mt-1 flex justify-between text-xs">
                <span>1</span>
                <span>{report.byDay.length}</span>
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
                {(["reception", "online", "whatsapp"] as const).map((s) => (
                  <div key={s} className="bg-muted rounded-lg p-2">
                    <div className="text-muted-foreground text-xs">{t(`source.${s}`)}</div>
                    <div className="font-semibold">{now.bySource[s]}</div>
                  </div>
                ))}
              </div>
              <p className="text-muted-foreground mt-2 text-xs">
                {t("cancelled", { n: now.cancelled })}
              </p>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>{t("byDoctor")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table data-testid="report-doctors">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("doctor")}</TableHead>
                      <TableHead>{t("bookings")}</TableHead>
                      <TableHead>{t("completed")}</TableHead>
                      <TableHead>{t("noShowShort")}</TableHead>
                      <TableHead>{t("value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byDoctor.map((d) => (
                      <TableRow key={d.id}>
                        <TableCell>{d.name}</TableCell>
                        <TableCell>{d.bookings}</TableCell>
                        <TableCell>{d.completed}</TableCell>
                        <TableCell>{d.noShow}</TableCell>
                        <TableCell>{sar(d.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>{t("byService")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table data-testid="report-services">
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("service")}</TableHead>
                      <TableHead>{t("completed")}</TableHead>
                      <TableHead>{t("value")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byService.slice(0, 15).map((s) => (
                      <TableRow key={s.id}>
                        <TableCell>{name(s)}</TableCell>
                        <TableCell>{s.completed}</TableCell>
                        <TableCell>{sar(s.value)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          </div>

          {allBranches && report.byBranch.length > 1 && (
            <Card>
              <CardHeader>
                <CardTitle>{t("byBranch")}</CardTitle>
              </CardHeader>
              <CardContent className="p-0">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("branch")}</TableHead>
                      <TableHead>{t("bookings")}</TableHead>
                      <TableHead>{t("completed")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {report.byBranch.map((b) => (
                      <TableRow key={b.id}>
                        <TableCell>{name(b)}</TableCell>
                        <TableCell>{b.bookings}</TableCell>
                        <TableCell>{b.completed}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {can(ctx.roles, "invoicing:export") && !ctx.support && (
        <Card data-testid="daily-export">
          <CardHeader>
            <CardTitle>{t("dailyTitle")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <p className="text-muted-foreground">{t("dailyHint")}</p>
            <form action="/export/daily" className="flex flex-wrap items-center gap-2">
              <Input
                type="date"
                name="day"
                defaultValue={day}
                max={today}
                className="w-44"
                aria-label={t("day")}
              />
              {report.branchId && <input type="hidden" name="branch" value={report.branchId} />}
              <Button type="submit" variant="outline" size="sm">
                <Download />
                {t("dailyDownload")}
              </Button>
            </form>
          </CardContent>
        </Card>
      )}
    </div>
  );
}

async function ChangeLabel() {
  const t = await getTranslations("reports");
  return <>{t("vsLastMonth")}</>;
}

function change(
  now: Totals,
  before: Totals,
  k: "bookings" | "completed" | "visitValue" | "packagesSold" | "newPatients",
) {
  if (!before[k]) return undefined;
  return Math.round(((now[k] - before[k]) / before[k]) * 100);
}

function Tile({
  label,
  value,
  hint,
  change,
  lowerIsBetter,
  gold,
}: {
  label: string;
  value: string | number;
  hint?: string;
  change?: number;
  lowerIsBetter?: boolean;
  gold?: boolean;
}) {
  const good = change !== undefined && (lowerIsBetter ? change < 0 : change > 0);
  const bad = change !== undefined && (lowerIsBetter ? change > 0 : change < 0);
  return (
    <Card className={gold ? "bg-gold" : undefined}>
      <CardContent className="flex flex-col gap-1 pt-4 pb-4">
        <span className="text-muted-foreground text-xs">{label}</span>
        <span className={gold ? "text-gold-foreground text-xl font-bold" : "text-xl font-bold"}>
          {value}
        </span>
        {hint && <span className="text-muted-foreground text-xs">{hint}</span>}
        {change !== undefined && change !== 0 && (
          <span
            className={
              good
                ? "text-success-foreground text-xs"
                : bad
                  ? "text-danger-foreground text-xs"
                  : "text-xs"
            }
          >
            {change > 0 ? `+${change}` : change}
            % <ChangeLabel />
          </span>
        )}
      </CardContent>
    </Card>
  );
}
