import { getLocale, getTranslations } from "next-intl/server";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { MyDayList } from "@/components/clinic/my-day-list";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { addDays, dayRange, isDay, riyadhDay } from "@/lib/booking/time";
import Link from "next/link";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { formatDualDate } from "@/lib/format";
import { loadAppointments, loadBlocks, loadDoctors, loadRooms } from "@/lib/views/schedule";
import type { Locale } from "@/i18n/config";

/** The doctor's day on their phone. */
export default async function MyDayPage({
  searchParams,
}: {
  searchParams: Promise<{ date?: string }>;
}) {
  const ctx = await requirePermission("my_day:view");
  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("myDay");
  const tc = await getTranslations("calendar");
  const branch = ctx.activeBranch;
  if (!ctx.memberId || !branch) return null;
  const today = riyadhDay(new Date());
  const day = isDay(sp.date) ? sp.date : today;
  const [from, to] = dayRange(day);

  const data = await withActor(actorOf(ctx), async (tx) => {
    const [appointments, blocks, rooms, doctors, settings] = await Promise.all([
      loadAppointments(tx, { from, to, practitionerId: ctx.memberId! }),
      loadBlocks(tx, { branchId: branch.id, from, to, memberId: ctx.memberId! }),
      loadRooms(tx, branch.id),
      loadDoctors(tx, branch.id),
      getSettings(tx),
    ]);
    return { appointments, blocks, rooms, doctors, settings };
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
      <Notice tone="info">
        {data.settings.doctorsManageOwnSchedule ? t("ownSchedule") : t("requestMode")}
      </Notice>
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
      />
      <p className="text-muted-foreground text-center text-xs">{t("installHint")}</p>
      <AutoRefresh
        versionUrl={`/api/calendar/version?from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`}
      />
    </div>
  );
}
