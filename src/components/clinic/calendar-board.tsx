"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ApptView, BlockView } from "@/lib/views/schedule";
import { cn } from "@/lib/utils";
import { AlertBadge, BalanceBadge, SourceBadge } from "./badges";
import { AppointmentDialog, type AppointmentPermissions } from "./appointment-dialog";
import { BookingDialog, type PickOption, type ServiceOption } from "./booking-dialog";
import { RunningLateButton } from "@/components/whatsapp/running-late";
import { BLOCKED_CLASSES, STATUS_CLASSES } from "./status";
import { hhmm, riyadhParts, todayRiyadh } from "./time";

export interface BoardColumn {
  key: string;
  title: string;
  subtitle?: string;
  /** Booking from this column: which doctor and which day. */
  doctorId?: string;
  day: string;
  /** Working hours (minutes) and break, to shade unavailable time. */
  hours?: { start: number; end: number; breaks: { start: number; end: number }[] } | null;
  appointments: ApptView[];
  blocks: BlockView[];
}

const PX_PER_MIN = 1.6;

export function CalendarBoard({
  columns,
  startMin,
  endMin,
  branchId,
  services,
  doctors,
  canBook,
  memberId,
  canManage,
  doctorsManageOwnSchedule,
  preselectPatient,
}: {
  columns: BoardColumn[];
  startMin: number;
  endMin: number;
  branchId: string;
  services: ServiceOption[];
  doctors: PickOption[];
  canBook: boolean;
  memberId: string | null;
  canManage: boolean;
  doctorsManageOwnSchedule: boolean;
  preselectPatient?: {
    id: string;
    fileNumber: string;
    nameAr: string;
    nameEn: string | null;
    phone: string;
  } | null;
}) {
  const t = useTranslations("calendar");
  const ts = useTranslations("statuses");
  const tsrc = useTranslations("sources");
  const locale = useLocale();
  // Keep only the id: after a change the page reloads and we show the fresh appointment.
  const [openId, setOpenId] = useState<string | null>(null);
  // Which column a phone shows: the signed-in doctor's own column, else the first one.
  // Week view: today's column; day view: the signed-in doctor's own column; else the first.
  const [focus, setFocus] = useState(() => {
    const today = columns.findIndex((c) => c.day === todayRiyadh());
    const own = columns.findIndex((c) => c.doctorId && c.doctorId === memberId);
    const byDay = new Set(columns.map((c) => c.day)).size > 1;
    return Math.max(0, byDay ? today : own);
  });
  const open = openId
    ? (columns.flatMap((c) => c.appointments).find((a) => a.id === openId) ?? null)
    : null;
  const [booking, setBooking] = useState<{ day: string; time?: string; doctorId?: string } | null>(
    preselectPatient && canBook ? { day: columns[0]?.day ?? "" } : null,
  );
  const weekView = new Set(columns.map((c) => c.day)).size > 1;
  const height = (endMin - startMin) * PX_PER_MIN;
  const hours = Array.from(
    { length: Math.ceil((endMin - startMin) / 60) + 1 },
    (_, i) => startMin + i * 60,
  );
  const y = (m: number) => (m - startMin) * PX_PER_MIN;

  return (
    <div className="flex flex-col gap-3">
      {canBook && (
        <Button
          className="self-start"
          onClick={() => setBooking({ day: columns[0]?.day ?? "", doctorId: columns[0]?.doctorId })}
          data-testid="new-booking"
        >
          <CalendarPlus />
          {t("newBooking")}
        </Button>
      )}
      {/* Phones show one column at a time; these buttons wrap (no sideways scrolling). */}
      {columns.length > 1 && (
        <div
          className="flex flex-wrap gap-2 md:hidden"
          role="tablist"
          aria-label={t("selectDoctor")}
          data-testid="column-picker"
        >
          {columns.map((col, i) => (
            <Button
              key={col.key}
              type="button"
              size="sm"
              role="tab"
              aria-selected={i === focus}
              variant={i === focus ? "default" : "outline"}
              onClick={() => setFocus(i)}
            >
              {col.title}
              <span className="opacity-70">({col.appointments.length})</span>
            </Button>
          ))}
        </div>
      )}
      <div className="bg-card overflow-x-auto rounded-xl border" data-testid="calendar-board">
        <div className="flex md:min-w-max">
          {/* time axis */}
          <div className="bg-card sticky start-0 z-10 w-14 shrink-0 border-e">
            <div className="h-12 border-b" />
            <div className="relative" style={{ height }}>
              {hours.map((h) => (
                <div
                  key={h}
                  className="text-muted-foreground absolute inset-x-0 -translate-y-2 pe-1 text-end text-xs"
                  style={{ top: y(h) }}
                  dir="ltr"
                >
                  {hhmm(h)}
                </div>
              ))}
            </div>
          </div>

          {columns.map((col, i) => (
            <div
              key={col.key}
              className={cn(
                "border-e last:border-e-0 md:block md:w-52 md:flex-none md:shrink-0",
                i === focus ? "min-w-0 flex-1" : "hidden",
              )}
              data-testid="calendar-column"
              data-column={col.title}
            >
              <div className="bg-card sticky top-0 flex h-12 flex-col justify-center border-b px-2">
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1 truncate text-sm font-semibold">{col.title}</div>
                  {canManage && !weekView && col.doctorId && col.day >= todayRiyadh() && (
                    <RunningLateButton
                      memberId={col.doctorId}
                      day={col.day}
                      doctorName={col.title}
                    />
                  )}
                </div>
                {col.subtitle && (
                  <div className="text-muted-foreground truncate text-xs">{col.subtitle}</div>
                )}
              </div>
              <div
                className={cn("relative", canBook && "cursor-copy")}
                style={{ height }}
                onClick={(e) => {
                  if (!canBook || e.target !== e.currentTarget) return;
                  const rect = e.currentTarget.getBoundingClientRect();
                  const minutes =
                    Math.floor(((e.clientY - rect.top) / PX_PER_MIN + startMin) / 15) * 15;
                  setBooking({
                    day: col.day,
                    time: hhmm(Math.max(startMin, minutes)),
                    doctorId: col.doctorId,
                  });
                }}
              >
                {hours.map((h) => (
                  <div
                    key={h}
                    className="border-border/60 pointer-events-none absolute inset-x-0 border-t"
                    style={{ top: y(h) }}
                  />
                ))}
                {/* outside working hours and break: shaded */}
                {col.hours === null && (
                  <div
                    className={cn(
                      "pointer-events-none absolute inset-0 opacity-60",
                      BLOCKED_CLASSES,
                    )}
                  />
                )}
                {col.hours && (
                  <>
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-x-0 top-0 opacity-60",
                        BLOCKED_CLASSES,
                      )}
                      style={{ height: Math.max(0, y(col.hours.start)) }}
                    />
                    <div
                      className={cn(
                        "pointer-events-none absolute inset-x-0 bottom-0 opacity-60",
                        BLOCKED_CLASSES,
                      )}
                      style={{ top: y(col.hours.end) }}
                    />
                    {col.hours.breaks.map((b) => (
                      <div
                        key={b.start}
                        className={cn(
                          "pointer-events-none absolute inset-x-0 flex items-center justify-center text-xs opacity-80",
                          BLOCKED_CLASSES,
                        )}
                        style={{
                          top: y(b.start),
                          height: (b.end - b.start) * PX_PER_MIN,
                        }}
                      >
                        {t("break")}
                      </div>
                    ))}
                  </>
                )}

                {col.blocks.map((b) => {
                  const s = riyadhParts(b.startsAt).minutes;
                  const e = riyadhParts(b.endsAt).minutes;
                  return (
                    <div
                      key={b.id}
                      data-testid="time-block"
                      className={cn(
                        "pointer-events-none absolute inset-x-1 overflow-hidden rounded-md border border-dashed px-1.5 py-1 text-xs",
                        BLOCKED_CLASSES,
                      )}
                      style={{ top: y(s), height: Math.max(18, (e - s) * PX_PER_MIN) }}
                    >
                      {t("blocked")}
                      {b.reason ? ` · ${b.reason}` : ""}
                    </div>
                  );
                })}

                {col.appointments.map((a) => {
                  const s = riyadhParts(a.startsAt).minutes;
                  const e = riyadhParts(a.endsAt).minutes;
                  return (
                    <button
                      key={a.id}
                      type="button"
                      data-testid="appointment"
                      data-status={a.status}
                      data-source={a.source}
                      data-patient={a.patient.fileNumber}
                      onClick={() => setOpenId(a.id)}
                      className={cn(
                        "border-foreground/10 shadow-card focus-visible:ring-ring absolute inset-x-1 flex flex-col overflow-hidden rounded-md border px-1.5 py-1 text-start text-xs focus-visible:ring-2",
                        STATUS_CLASSES[a.status],
                      )}
                      style={{ top: y(s), height: Math.max(22, (e - s) * PX_PER_MIN) }}
                      title={`${riyadhParts(a.startsAt).time} ${a.patient.nameAr} — ${ts(a.status)}${a.source !== "reception" ? ` · ${tsrc(a.source)}` : ""}`}
                    >
                      <span className="flex min-w-0 items-center gap-1">
                        <span dir="ltr" className="font-semibold">
                          {riyadhParts(a.startsAt).time}
                        </span>
                        <SourceBadge source={a.source} label={tsrc(a.source)} compact />
                        <AlertBadge alerts={a.alerts} label={t("allergy")} compact />
                        {a.balance && (
                          <BalanceBadge
                            remaining={a.balance.remaining}
                            total={a.balance.total}
                            label={t("balance")}
                          />
                        )}
                        {e - s < 30 && (
                          <span className="truncate font-medium">
                            {locale === "en" && a.patient.nameEn
                              ? a.patient.nameEn
                              : a.patient.nameAr}
                          </span>
                        )}
                      </span>
                      {e - s >= 30 && (
                        <>
                          <span className="truncate font-medium">
                            {locale === "en" && a.patient.nameEn
                              ? a.patient.nameEn
                              : a.patient.nameAr}
                          </span>
                          <span className="truncate opacity-80">
                            {locale === "en" ? a.serviceNameEn : a.serviceNameAr}
                          </span>
                        </>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <AppointmentDialog
          key={openId ?? "none"}
          appt={open}
          onClose={() => setOpenId(null)}
          doctors={doctors}
          perms={
            {
              manage: canManage,
              own: !!open && open.practitionerId === memberId,
              doctorsManageOwnSchedule,
            } satisfies AppointmentPermissions
          }
        />
        {booking && (
          <BookingDialog
            open
            onClose={() => setBooking(null)}
            branchId={branchId}
            services={services}
            doctors={doctors}
            defaults={{ ...booking, patient: preselectPatient ?? null }}
          />
        )}
      </div>
    </div>
  );
}
