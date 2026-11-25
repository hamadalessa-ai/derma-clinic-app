"use client";

import { EmptyState } from "@/components/ui/empty-state";
import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Clock,
  DoorOpen,
  FileText,
  Trash2,
  UserRound,
  Video,
} from "lucide-react";
import { blockTimeAction, removeBlockAction, statusAction } from "@/app/actions/clinic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { ApptView, BlockView } from "@/lib/views/schedule";
import { AlertBadge, BalanceBadge, SourceBadge, StatusBadge } from "./badges";
import { AppointmentDialog } from "./appointment-dialog";
import type { PickOption } from "./booking-dialog";
import { FormError, FormSuccess } from "./form-message";
import { riyadhParts } from "./time";
import { StartVisitButton } from "./start-visit";
import { useAction } from "./use-action";

export function MyDayList({
  appointments,
  blocks,
  rooms,
  doctors,
  memberId,
  branchId,
  day,
  doctorsManageOwnSchedule,
  assisting = false,
}: {
  appointments: ApptView[];
  blocks: BlockView[];
  rooms: Record<string, { nameAr: string; nameEn: string }>;
  doctors: PickOption[];
  memberId: string;
  branchId: string;
  day: string;
  doctorsManageOwnSchedule: boolean;
  /**
   * A nurse / assistant's day: her doctors' patients, each with the doctor's name. She brings
   * the patient in and prepares the note; confirming, moving and blocking time are the doctor's.
   */
  assisting?: boolean;
}) {
  const t = useTranslations("myDay");
  const tc = useTranslations("calendar");
  const ts = useTranslations("statuses");
  const tsrc = useTranslations("sources");
  const tcom = useTranslations("common");
  const locale = useLocale();
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const [openId, setOpenId] = useState<string | null>(null);
  const open = appointments.find((a) => a.id === openId) ?? null;
  const { run, pending, error } = useAction();
  const block = useAction();
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("14:00");
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  const doctorName = (id: string) => {
    const d = doctors.find((x) => x.id === id);
    return d ? name(d) : "";
  };
  const next = (a: ApptView) =>
    assisting
      ? null
      : a.status === "booked"
        ? { to: "confirmed", label: t("confirm"), icon: CalendarCheck }
        : a.status === "in_session"
          ? { to: "completed", label: t("complete"), icon: CheckCircle2 }
          : null;

  // One main action on the screen: the visit happening now (in session, then arrived), else the
  // next one still to come. Finished visits fold away under "Done today".
  const finished = (a: ApptView) => a.status === "completed" || a.status === "no_show";
  const current = appointments.filter((a) => !finished(a));
  const done = appointments.filter(finished);
  const now = Date.now();
  const focus =
    current.find((a) => a.status === "in_session") ??
    current.find((a) => a.status === "arrived") ??
    current.find((a) => new Date(a.endsAt).getTime() > now) ??
    null;

  const card = (a: ApptView) => {
    const n = next(a);
    const start = riyadhParts(a.startsAt).time;
    const end = riyadhParts(a.endsAt).time;
    const room = rooms[a.roomId];
    const main = focus?.id === a.id;
    const mainVariant = main ? "default" : "outline";
    return (
      <Card
        key={a.id}
        data-testid="my-day-card"
        data-status={a.status}
        data-source={a.source}
        data-patient={a.patient.fileNumber}
        data-focus={main ? "true" : undefined}
        className={main ? "ring-brand ring-2" : ""}
      >
        <CardContent className="flex flex-col gap-2 pt-4">
          {main && (
            <span className="text-brand-strong text-xs font-semibold" data-testid="my-day-focus">
              {a.status === "in_session" || a.status === "arrived" ? t("now") : t("next")}
            </span>
          )}
          <div className="flex items-center justify-between gap-2">
            <span className="text-lg font-bold" dir="ltr">
              {start}–{end}
            </span>
            <span className="flex items-center gap-1.5">
              <SourceBadge source={a.source} label={tsrc(a.source)} />
              <StatusBadge status={a.status} label={ts(a.status)} />
            </span>
          </div>
          <button
            type="button"
            className="flex flex-wrap items-center gap-2 text-start"
            onClick={() => setOpenId(a.id)}
          >
            <span className="text-base font-semibold">{name(a.patient)}</span>
            <AlertBadge alerts={a.alerts} label={tc("allergy")} />
            {a.balance && (
              <BalanceBadge
                remaining={a.balance.remaining}
                total={a.balance.total}
                label={tc("balance")}
              />
            )}
          </button>
          <div className="text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>{locale === "en" ? a.serviceNameEn : a.serviceNameAr}</span>
            {room && (
              <span className="inline-flex items-center gap-1">
                <DoorOpen className="size-4" />
                {locale === "en" ? room.nameEn : room.nameAr}
              </span>
            )}
            {assisting && (
              <span className="text-foreground font-medium" data-testid="my-day-doctor">
                {doctorName(a.practitionerId)}
              </span>
            )}
            {a.pendingRequest && (
              <span className="text-warning-foreground">{t("pendingRequest")}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {/* The patient is here: one tap starts the visit and opens its screen. */}
            {a.status === "arrived" && !a.isVirtual && (
              <StartVisitButton
                appointmentId={a.id}
                label={t("startVisit")}
                size="sm"
                variant={mainVariant}
                navigate
              />
            )}
            {a.isVirtual && !finished(a) && a.status !== "cancelled" ? (
              <Link
                href={`/visits/${a.id}`}
                className={buttonVariants({ variant: mainVariant, size: "sm" })}
                data-testid="start-video"
              >
                <Video />
                {t("startVideo")}
              </Link>
            ) : (
              a.status !== "arrived" && (
                <Link
                  href={`/visits/${a.id}`}
                  className={buttonVariants({
                    variant: a.status === "in_session" ? mainVariant : "outline",
                    size: "sm",
                  })}
                  data-testid="open-visit"
                >
                  <FileText />
                  {a.status === "in_session" ? t("continueVisit") : t("openVisit")}
                </Link>
              )
            )}
            {n && (
              <Button
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => run(() => statusAction({ appointmentId: a.id, to: n.to }))}
              >
                <n.icon />
                {n.label}
              </Button>
            )}
            <Link
              href={`/patients/${a.patient.id}`}
              className={buttonVariants({ variant: "ghost", size: "sm" })}
            >
              <UserRound />
              {tc("openProfile")}
            </Link>
            {!assisting && (a.status === "booked" || a.status === "confirmed") && (
              <Button size="sm" variant="ghost" onClick={() => setOpenId(a.id)}>
                {t("reschedule")}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="flex flex-col gap-3">
      <FormError message={error} />
      {appointments.length === 0 && (
        <Card>
          <EmptyState icon={<CalendarCheck />} title={t("empty")} />
        </Card>
      )}
      {current.map(card)}
      {done.length > 0 && (
        <details className="group" data-testid="my-day-done" open={current.length === 0}>
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium">
            <CheckCircle2 className="size-4" />
            {t("doneToday", { count: done.length })}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <div className="flex flex-col gap-3 pt-1">{done.map(card)}</div>
        </details>
      )}

      {!assisting && (
        <details className="group" open={blocks.length > 0}>
          <summary className="text-muted-foreground hover:text-foreground flex cursor-pointer list-none items-center gap-2 py-2 text-sm font-medium">
            <Clock className="size-4" />
            {t("blockTime")}
            <ChevronDown className="size-4 transition-transform group-open:rotate-180" />
          </summary>
          <Card>
            <CardContent className="flex flex-col gap-3 pt-4">
              {blocks.length > 0 && (
                <ul className="flex flex-col gap-1 text-sm">
                  {blocks.map((b) => (
                    <li
                      key={b.id}
                      className="bg-muted flex items-center justify-between rounded-md px-3 py-1.5"
                    >
                      <span>
                        <span dir="ltr">
                          {riyadhParts(b.startsAt).time}–{riyadhParts(b.endsAt).time}
                        </span>
                        {b.reason ? ` · ${b.reason}` : ""}
                      </span>
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={t("removeBlock")}
                        onClick={() => block.run(() => removeBlockAction(b.id))}
                      >
                        <Trash2 />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="block-from">{t("blockFrom")}</Label>
                  <Input
                    id="block-from"
                    type="time"
                    step={900}
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="block-to">{t("blockTo")}</Label>
                  <Input
                    id="block-to"
                    type="time"
                    step={900}
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                    dir="ltr"
                  />
                </div>
                <div className="col-span-2 flex flex-col gap-1">
                  <Label htmlFor="block-reason">{t("blockReason")}</Label>
                  <Input
                    id="block-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                  />
                </div>
              </div>
              <FormError message={block.error} />
              <FormSuccess message={msg} />
              <Button
                className="self-end"
                disabled={block.pending}
                onClick={() =>
                  block.run(
                    () =>
                      blockTimeAction({
                        branchId,
                        memberId,
                        day,
                        from,
                        to,
                        reason: reason || undefined,
                      }),
                    () => {
                      setMsg(t("blockedOk"));
                      setReason("");
                    },
                  )
                }
              >
                {tcom("save")}
              </Button>
            </CardContent>
          </Card>
        </details>
      )}

      <AppointmentDialog
        key={openId ?? "none"}
        appt={open}
        onClose={() => setOpenId(null)}
        doctors={doctors}
        perms={{
          manage: false,
          own: !!open && open.practitionerId === memberId,
          doctorsManageOwnSchedule,
        }}
      />
    </div>
  );
}
