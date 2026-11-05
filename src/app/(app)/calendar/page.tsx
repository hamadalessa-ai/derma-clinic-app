import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { ArrivalsList } from "@/components/clinic/arrivals-list";
import { CalendarBoard, type BoardColumn } from "@/components/clinic/calendar-board";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { addDays, dayRange, isDay, riyadhDay, weekDays } from "@/lib/booking/time";
import { formatDualDate } from "@/lib/format";
import { getPatient } from "@/lib/patients/queries";
import { pick } from "@/lib/brand";
import { cn } from "@/lib/utils";
import {
  loadAppointments,
  loadBlocks,
  loadDoctors,
  loadRooms,
  loadServices,
} from "@/lib/views/schedule";
import type { Locale } from "@/i18n/config";

type Search = { date?: string; view?: string; by?: string; doctor?: string; patient?: string };

export default async function CalendarPage({ searchParams }: { searchParams: Promise<Search> }) {
  const ctx = await requirePermission("calendar:view");
  const sp = await searchParams;
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("calendar");
  const tw = await getTranslations("common");
  const branch = ctx.activeBranch;
  if (!branch) return null;

  const day = isDay(sp.date) ? sp.date : riyadhDay(new Date());
  const view = sp.view === "week" ? "week" : sp.view === "list" ? "list" : "day";
  const by = sp.by === "room" ? "room" : "doctor";
  const actor = actorOf(ctx);
  const th = await getTranslations("hours");

  const data = await withActor(actor, async (tx) => {
    const shownDays = view === "week" ? weekDays(day) : [day];
    const [doctors, rooms, services, settings] = await Promise.all([
      loadDoctors(tx, branch.id, shownDays),
      loadRooms(tx, branch.id),
      loadServices(tx),
      getSettings(tx),
    ]);
    const weekDoctor =
      doctors.find((d) => d.id === sp.doctor) ??
      doctors.find((d) => d.id === ctx.memberId) ??
      doctors[0];
    const days = view === "week" ? weekDays(day) : [day];
    const from = dayRange(days[0])[0];
    const to = dayRange(days[days.length - 1])[1];
    const [appointments, blocks, preselect] = await Promise.all([
      loadAppointments(tx, {
        branchId: branch.id,
        from,
        to,
        practitionerId: view === "week" ? weekDoctor?.id : undefined,
      }),
      loadBlocks(tx, { branchId: branch.id, from, to }),
      sp.patient && can(ctx.roles, "appointments:manage")
        ? getPatient(tx, sp.patient).catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      doctors,
      rooms,
      services,
      settings,
      weekDoctor,
      days,
      from,
      to,
      appointments,
      blocks,
      preselect,
    };
  });

  const visible = data.appointments.filter((a) => a.status !== "cancelled");
  let columns: BoardColumn[];
  if (view === "week" && data.weekDoctor) {
    const doc = data.weekDoctor;
    columns = data.days.map((d) => {
      const [s, e] = dayRange(d);
      return {
        key: d,
        title: formatDualDate(new Date(`${d}T12:00:00+03:00`), locale, "short").split(" · ")[0],
        subtitle: new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-nu-latn" : "en-SA", {
          weekday: "long",
          timeZone: "Asia/Riyadh",
        }).format(new Date(`${d}T12:00:00+03:00`)),
        doctorId: doc.id,
        day: d,
        hours: doc.hours[d] ?? null,
        appointments: visible.filter(
          (a) => a.startsAt >= s.toISOString() && a.startsAt < e.toISOString(),
        ),
        blocks: data.blocks.filter(
          (b) =>
            b.memberId === doc.id && b.startsAt < e.toISOString() && b.endsAt > s.toISOString(),
        ),
      };
    });
  } else if (by === "room") {
    columns = data.rooms.map((r) => ({
      key: r.id,
      title: pick(locale, r.nameAr, r.nameEn),
      day,
      hours: undefined,
      appointments: visible.filter((a) => a.roomId === r.id),
      blocks: data.blocks.filter((b) => b.roomId === r.id),
    }));
  } else {
    columns = data.doctors.map((d) => ({
      key: d.id,
      title: pick(locale, d.nameAr, d.nameEn),
      doctorId: d.id,
      day,
      hours: d.hours[day] ?? null,
      appointments: visible.filter((a) => a.practitionerId === d.id),
      blocks: data.blocks.filter((b) => b.memberId === d.id),
    }));
  }

  const qs = (over: Partial<Search>) => {
    const params = new URLSearchParams({
      date: day,
      view,
      by,
      ...(data.weekDoctor ? { doctor: data.weekDoctor.id } : {}),
      ...over,
    });
    return `/calendar?${params}`;
  };
  const step = view === "week" ? 7 : 1;
  const tab = (active: boolean) =>
    cn(buttonVariants({ variant: active ? "default" : "outline", size: "sm" }));
  const doctorOptions = data.doctors.map((d) => ({ id: d.id, nameAr: d.nameAr, nameEn: d.nameEn }));
  const pre = data.preselect;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("title")}
        subtitle={`${pick(locale, branch.nameAr, branch.nameEn)} · ${view === "week" ? t("weekOf", { date: formatDualDate(new Date(`${data.days[0]}T12:00:00+03:00`), locale, "medium") }) : formatDualDate(new Date(`${day}T12:00:00+03:00`), locale, "full")} · ${t("liveHint")}`}
        actions={
          <>
            <Link
              href={qs({ date: addDays(day, -step) })}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={t("prev")}
            >
              <ChevronRight className="ltr:rotate-180" />
            </Link>
            <Link
              href={qs({ date: riyadhDay(new Date()) })}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              {t("today")}
            </Link>
            <Link
              href={qs({ date: addDays(day, step) })}
              className={buttonVariants({ variant: "outline", size: "icon" })}
              aria-label={t("next")}
            >
              <ChevronLeft className="ltr:rotate-180" />
            </Link>
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <Link href={qs({ view: "day" })} className={tab(view === "day")}>
          {t("day")}
        </Link>
        <Link href={qs({ view: "week" })} className={tab(view === "week")}>
          {t("week")}
        </Link>
        <Link
          href={qs({ view: "list" })}
          className={tab(view === "list")}
          data-testid="arrivals-tab"
        >
          {t("arrivals")}
        </Link>
        {can(ctx.roles, "hours:edit") && (
          <Link href="/working-hours" className={tab(false)} data-testid="working-hours-link">
            {th("title")}
          </Link>
        )}
        <span className="bg-border mx-1 h-6 w-px" />
        {view === "day" ? (
          <>
            <Link href={qs({ by: "doctor" })} className={tab(by === "doctor")}>
              {t("byDoctor")}
            </Link>
            <Link href={qs({ by: "room" })} className={tab(by === "room")}>
              {t("byRoom")}
            </Link>
          </>
        ) : view === "week" ? (
          data.doctors.map((d) => (
            <Link
              key={d.id}
              href={qs({ doctor: d.id })}
              className={tab(d.id === data.weekDoctor?.id)}
            >
              {pick(locale, d.nameAr, d.nameEn)}
            </Link>
          ))
        ) : null}
        <span className="text-muted-foreground ms-auto text-xs">
          {visible.length} · {tw("doctor")}: {data.doctors.length}
        </span>
      </div>

      {view === "list" ? (
        <ArrivalsList
          appointments={data.appointments}
          doctors={doctorOptions}
          canManage={can(ctx.roles, "appointments:manage")}
          memberId={ctx.memberId}
          doctorsManageOwnSchedule={data.settings.doctorsManageOwnSchedule}
        />
      ) : (
      <CalendarBoard
        columns={columns}
        startMin={10 * 60}
        endMin={20 * 60}
        branchId={branch.id}
        services={data.services.map((s) => ({
          id: s.id,
          nameAr: s.nameAr,
          nameEn: s.nameEn,
          durationMinutes: s.durationMinutes,
        }))}
        doctors={doctorOptions}
        canBook={can(ctx.roles, "appointments:manage")}
        canManage={can(ctx.roles, "appointments:manage")}
        memberId={ctx.memberId}
        doctorsManageOwnSchedule={data.settings.doctorsManageOwnSchedule}
        preselectPatient={
          pre
            ? {
                id: pre.id,
                fileNumber: pre.fileNumber,
                nameAr: pre.fullNameAr,
                nameEn: pre.fullNameEn,
                phone: pre.phone,
              }
            : null
        }
      />
      )}
      <AutoRefresh
        versionUrl={`/api/calendar/version?from=${encodeURIComponent(data.from.toISOString())}&to=${encodeURIComponent(data.to.toISOString())}`}
      />
    </div>
  );
}
