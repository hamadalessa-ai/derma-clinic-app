import { getLocale, getTranslations } from "next-intl/server";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { MyDayList } from "@/components/clinic/my-day-list";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { dayRange, riyadhDay } from "@/lib/booking/time";
import { formatDualDate } from "@/lib/format";
import { loadAppointments, loadBlocks, loadDoctors, loadRooms } from "@/lib/views/schedule";
import type { Locale } from "@/i18n/config";

/** The doctor's day on their phone. */
export default async function MyDayPage() {
  const ctx = await requirePermission("my_day:view");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("myDay");
  const branch = ctx.activeBranch;
  if (!ctx.memberId || !branch) return null;
  const day = riyadhDay(new Date());
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
        subtitle={`${formatDualDate(new Date(), locale, "full")} · ${t("count", { count: active.length })}`}
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
