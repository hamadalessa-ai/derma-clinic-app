import { getLocale, getTranslations } from "next-intl/server";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { MyDayList } from "@/components/clinic/my-day-list";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { assistedDoctors } from "@/lib/care-team/care-team";
import { getSettings } from "@/lib/booking/engine";
import { addDays, dayRange, isDay, riyadhDay } from "@/lib/booking/time";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Flag } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { pick } from "@/lib/brand";
import { concernLink } from "@/lib/push/links";
import { findConcerns } from "@/lib/whatsapp/concerns";
import { buttonVariants } from "@/components/ui/button";
import { formatDualDate } from "@/lib/format";
import { loadAppointments, loadBlocks, loadDoctors, loadRooms } from "@/lib/views/schedule";
import type { Locale } from "@/i18n/config";

/** The doctor's day on their phone — or, for a nurse / assistant, her doctors' day. */
export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requirePermission("my_day:view");
  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("myDay");
  const th = await getTranslations("hours");
  const tc = await getTranslations("calendar");
  const tco = await getTranslations("concerns");
  const branch = ctx.activeBranch;
  if (!ctx.memberId || !branch) return null;
  const today = riyadhDay(new Date());
  const day = isDay(sp.date) ? sp.date : today;
  const [from, to] = dayRange(day);

  // A nurse / assistant (not also a doctor) sees the day of the doctors she works with.
  const assisting = !ctx.roles.includes("practitioner");
  const actor = actorOf(ctx);
  const data = await withActor(actor, async (tx) => {
    const team = assisting ? await assistedDoctors(tx, actor) : [];
    const [appointments, blocks, rooms, doctors, settings, concerns] = await Promise.all([
      assisting
        ? loadAppointments(tx, { from, to, practitionerIds: team.map((d) => d.memberId) })
        : loadAppointments(tx, { from, to, practitionerId: ctx.memberId! }),
      assisting
        ? Promise.resolve([])
        : loadBlocks(tx, { branchId: branch.id, from, to, memberId: ctx.memberId! }),
      loadRooms(tx, branch.id),
      loadDoctors(tx, branch.id),
      getSettings(tx),
      // Open post-care concerns about this doctor's own patients (any day, not only this one).
      assisting
        ? Promise.resolve([])
        : findConcerns(tx, { practitionerId: ctx.memberId!, openOnly: true }),
    ]);
    return { appointments, blocks, rooms, doctors, settings, concerns, team };
  });
  const active = data.appointments.filter((a) => a.status !== "cancelled");

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={`${formatDualDate(new Date(`${day}T12:00:00+03:00`), locale, "full")} · ${t("count", { count: active.length })}`}
        actions={
          <>
            <Link
              href={`/my-day?date=${addDays(day, -1)}`}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={tc("prev")}
            >
              <ChevronRight className="ltr:rotate-180" />
            </Link>
            {day !== today && (
              <Link href="/my-day" className={buttonVariants({ variant: "outline", size: "sm" })}>
                {tc("today")}
              </Link>
            )}
            <Link
              href={`/my-day?date=${addDays(day, 1)}`}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={tc("next")}
            >
              <ChevronLeft className="ltr:rotate-180" />
            </Link>
          </>
        }
      />
      {data.concerns.length > 0 && (
        <Card data-testid="my-concerns" className="border-destructive">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Flag className="text-destructive size-5" aria-hidden />
              {tco("title", { count: data.concerns.length })}
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col divide-y p-0">
            {data.concerns.map((c) => (
              <Link
                key={c.appointmentId}
                href={concernLink(c)}
                data-testid="my-concern"
                data-patient={c.fileNumber}
                className="hover:bg-muted flex flex-wrap items-center gap-2 px-4 py-3 text-sm"
              >
                <Badge variant="destructive">{tco("badge")}</Badge>
                <span className="font-medium">
                  {pick(locale, c.patientNameAr, c.patientNameEn)}
                </span>
                <span className="text-muted-foreground">
                  {tco("afterVisit", {
                    service: pick(locale, c.serviceNameAr, c.serviceNameEn),
                    date: formatDualDate(c.visitAt, locale, "medium").split(" · ")[0],
                  })}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>
      )}
      {assisting ? (
        <Notice tone="info" data-testid="care-team-notice">
          {data.team.length
            ? t("careTeam", {
                names: data.team
                  .map((d) => (locale === "en" && d.nameEn ? d.nameEn : d.name))
                  .join("، "),
              })
            : t("noCareTeam")}
        </Notice>
      ) : (
        <Notice tone="info">
          {data.settings.doctorsManageOwnSchedule ? t("ownSchedule") : t("requestMode")}
        </Notice>
      )}
      {!assisting && data.settings.doctorsEditOwnHours && (
        <Link
          href="/working-hours"
          className="text-brand-strong self-start text-sm font-medium underline"
          data-testid="my-hours-link"
        >
          {th("myHours")}
        </Link>
      )}
      <MyDayList
        appointments={active}
        blocks={data.blocks}
        rooms={Object.fromEntries(
          data.rooms.map((r) => [r.id, { nameAr: r.nameAr, nameEn: r.nameEn }]),
        )}
        doctors={data.doctors.map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn }))}
        memberId={ctx.memberId}
        branchId={branch.id}
        day={day}
        doctorsManageOwnSchedule={data.settings.doctorsManageOwnSchedule}
        assisting={assisting}
      />
      <p className="text-muted-foreground text-center text-xs">{t("installHint")}</p>
      <AutoRefresh
        versionUrl={`/api/calendar/version?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`}
      />
    </div>
  );
}
