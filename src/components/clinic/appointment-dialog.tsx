"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowRightLeft,
  CalendarCheck,
  CheckCircle2,
  LogIn,
  Play,
  UserX,
  XCircle,
} from "lucide-react";
import {
  checkInAction,
  doctorRescheduleAction,
  moveAction,
  statusAction,
} from "@/app/actions/clinic";
import { buttonVariants, Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { ApptView } from "@/lib/views/schedule";
import { formatDualDate } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { AlertBadge, BalanceBadge, SourceBadge, StatusBadge } from "./badges";
import { ConsentSignDialog, type ConsentTemplateView } from "./consent-sign-dialog";
import { FormError, FormSuccess } from "./form-message";
import { riyadhParts, timeOptions } from "./time";
import { useAction } from "./use-action";
import type { PickOption } from "./booking-dialog";

export interface AppointmentPermissions {
  manage: boolean; // reception / admin
  own: boolean; // this is the signed-in doctor's own appointment
  doctorsManageOwnSchedule: boolean;
}

export function AppointmentDialog({
  appt,
  onClose,
  doctors,
  perms,
}: {
  appt: ApptView | null;
  onClose: () => void;
  doctors: PickOption[];
  perms: AppointmentPermissions;
}) {
  const t = useTranslations("calendar");
  const tc = useTranslations("common");
  const ts = useTranslations("statuses");
  const tsrc = useTranslations("sources");
  const tm = useTranslations("myDay");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const { run, pending, error } = useAction();
  const [message, setMessage] = useState<string | null>(null);
  const [mode, setMode] = useState<"none" | "cancel" | "move">("none");
  const [reason, setReason] = useState("");
  const [moveDay, setMoveDay] = useState("");
  const [moveTime, setMoveTime] = useState("");
  const [moveDoctor, setMoveDoctor] = useState("");
  const [consent, setConsent] = useState<ConsentTemplateView | null>(null);

  if (!appt) return null;
  const p = riyadhParts(appt.startsAt);
  const end = riyadhParts(appt.endsAt);
  const doctor = doctors.find((d) => d.id === appt.practitionerId);
  const s = appt.status;
  const canMoveDirect = perms.manage || (perms.own && perms.doctorsManageOwnSchedule);
  const canRequest = perms.own && !perms.manage;

  const setStatus = (to: string, extra?: { reason?: string }) =>
    run(
      () => statusAction({ appointmentId: appt.id, to, ...extra }),
      () => {
        setMessage(t("statusChanged"));
        setMode("none");
      },
    );

  const doCheckIn = () =>
    run(
      () => checkInAction(appt.id),
      (r) => {
        if (r.status === "consent_required") {
          setConsent(r.template);
          return;
        }
        if (r.status === "already_checked_in") setMessage(t("alreadyCheckedIn"));
        else if (r.deducted && r.remaining !== null && appt.balance)
          setMessage(
            `${t("checkedIn")} — ${t("deducted", { remaining: r.remaining, total: appt.balance.total })}`,
          );
        else setMessage(`${t("checkedIn")} — ${t("noPackage")}`);
      },
    );

  const openMove = () => {
    setMoveDay(p.day);
    setMoveTime(p.time);
    setMoveDoctor(appt.practitionerId);
    setMode("move");
  };

  return (
    <>
      <Dialog
        open={!!appt && !consent}
        onClose={onClose}
        title={t("appointment")}
        closeLabel={tc("close")}
      >
        <div className="flex flex-col gap-2 text-sm" data-testid="appointment-details">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold">{name(appt.patient)}</span>
            <span className="text-muted-foreground" dir="ltr">
              {appt.patient.fileNumber} · {appt.patient.phone}
            </span>
            <AlertBadge alerts={appt.alerts} label={t("allergy")} />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={s} label={ts(s)} />
            <SourceBadge source={appt.source} label={tsrc(appt.source)} />
            <span>{locale === "en" ? appt.serviceNameEn : appt.serviceNameAr}</span>
            {appt.balance && (
              <BalanceBadge
                remaining={appt.balance.remaining}
                total={appt.balance.total}
                label={t("balance")}
              />
            )}
          </div>
          <div className="text-muted-foreground">
            {formatDualDate(new Date(appt.startsAt), locale, "medium")} ·{" "}
            <span dir="ltr">
              {p.time}–{end.time}
            </span>
          </div>
          <div className="text-muted-foreground">
            {tc("doctor")}: {doctor ? name(doctor) : "—"}
            {appt.deviceNameAr &&
              ` · ${tc("device")}: ${locale === "en" ? appt.deviceNameEn : appt.deviceNameAr}`}
          </div>
          {appt.consent && (
            <div
              className={
                appt.consent.signed
                  ? "bg-success text-success-foreground rounded-md px-3 py-2"
                  : "bg-warning text-warning-foreground rounded-md px-3 py-2"
              }
              data-testid="consent-status"
              data-signed={appt.consent.signed}
            >
              {appt.consent.signed
                ? appt.consent.viaPatientPage
                  ? t("consentSignedOnline")
                  : t("consentSigned")
                : t("consentNeeded")}
            </div>
          )}
          {appt.needsCompletion && (
            <div
              className="bg-info text-info-foreground rounded-md px-3 py-2"
              data-testid="needs-completion"
            >
              {t("needsCompletion")}
            </div>
          )}
          {appt.note && <div className="bg-muted rounded-md px-3 py-2">{appt.note}</div>}
          {appt.pendingRequest && (
            <div className="bg-warning text-warning-foreground rounded-md px-3 py-2">
              {tm("pendingRequest")} →{" "}
              <span dir="ltr">
                {riyadhParts(appt.pendingRequest.proposedStartsAt).day}{" "}
                {riyadhParts(appt.pendingRequest.proposedStartsAt).time}
              </span>
            </div>
          )}
        </div>

        <FormSuccess message={message} />
        <FormError message={error} />

        <div className="flex flex-wrap gap-2">
          {perms.manage && s === "pending" && (
            <>
              <Button
                onClick={() => setStatus("confirmed")}
                disabled={pending}
                data-testid="approve"
              >
                <CalendarCheck />
                {t("approve")}
              </Button>
              <Button
                variant="destructive"
                onClick={() => setStatus("cancelled", { reason: t("rejectedReason") })}
                disabled={pending}
                data-testid="reject"
              >
                <XCircle />
                {t("reject")}
              </Button>
            </>
          )}
          {perms.manage && (s === "booked" || s === "confirmed") && (
            <Button onClick={doCheckIn} disabled={pending} data-testid="check-in">
              <LogIn />
              {t("checkIn")}
            </Button>
          )}
          {(perms.manage || perms.own) && s === "booked" && (
            <Button variant="outline" onClick={() => setStatus("confirmed")} disabled={pending}>
              <CalendarCheck />
              {t("confirm")}
            </Button>
          )}
          {(perms.manage || perms.own) && s === "arrived" && (
            <Button variant="outline" onClick={() => setStatus("in_session")} disabled={pending}>
              <Play />
              {t("start")}
            </Button>
          )}
          {(perms.manage || perms.own) && s === "in_session" && (
            <Button variant="outline" onClick={() => setStatus("completed")} disabled={pending}>
              <CheckCircle2 />
              {t("complete")}
            </Button>
          )}
          {(canMoveDirect || canRequest) && (s === "booked" || s === "confirmed") && (
            <Button variant="outline" onClick={openMove} disabled={pending}>
              <ArrowRightLeft />
              {t("move")}
            </Button>
          )}
          {perms.manage && (s === "booked" || s === "confirmed") && (
            <Button variant="outline" onClick={() => setStatus("no_show")} disabled={pending}>
              <UserX />
              {t("noShow")}
            </Button>
          )}
          {perms.manage && ["booked", "confirmed", "arrived"].includes(s) && (
            <Button variant="destructive" onClick={() => setMode("cancel")} disabled={pending}>
              <XCircle />
              {t("cancelAppointment")}
            </Button>
          )}
          <Link
            href={`/patients/${appt.patient.id}`}
            className={buttonVariants({ variant: "ghost" })}
          >
            {t("openProfile")}
          </Link>
        </div>

        {mode === "cancel" && (
          <div className="flex flex-col gap-2 rounded-md border p-3">
            <Label htmlFor="cancel-reason">{t("cancelReason")}</Label>
            <Input id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            <Button
              variant="destructive"
              className="self-end"
              disabled={pending}
              onClick={() => setStatus("cancelled", { reason })}
            >
              {tc("confirm")}
            </Button>
          </div>
        )}

        {mode === "move" && (
          <div className="grid gap-2 rounded-md border p-3 sm:grid-cols-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-day">{tc("date")}</Label>
              <Input
                id="move-day"
                type="date"
                value={moveDay}
                onChange={(e) => setMoveDay(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="move-time">{tc("time")}</Label>
              <Select
                id="move-time"
                value={moveTime}
                onChange={(e) => setMoveTime(e.target.value)}
                dir="ltr"
              >
                {timeOptions().map((o) => (
                  <option key={o}>{o}</option>
                ))}
              </Select>
            </div>
            {perms.manage && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="move-doctor">{tc("doctor")}</Label>
                <Select
                  id="move-doctor"
                  value={moveDoctor}
                  onChange={(e) => setMoveDoctor(e.target.value)}
                >
                  {doctors.map((d) => (
                    <option key={d.id} value={d.id}>
                      {name(d)}
                    </option>
                  ))}
                </Select>
              </div>
            )}
            {canRequest && !perms.doctorsManageOwnSchedule && (
              <div className="flex flex-col gap-1.5 sm:col-span-3">
                <Label htmlFor="move-reason">
                  {tc("reason")} ({tc("optional")})
                </Label>
                <Input
                  id="move-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <p className="text-muted-foreground text-xs">{tm("requestMode")}</p>
              </div>
            )}
            <Button
              className="sm:col-span-3 sm:justify-self-end"
              disabled={pending}
              onClick={() =>
                perms.manage
                  ? run(
                      () =>
                        moveAction({
                          appointmentId: appt.id,
                          day: moveDay,
                          time: moveTime,
                          practitionerId: moveDoctor,
                        }),
                      () => {
                        setMessage(t("movedOk"));
                        setMode("none");
                      },
                    )
                  : run(
                      () =>
                        doctorRescheduleAction({
                          appointmentId: appt.id,
                          day: moveDay,
                          time: moveTime,
                          reason: reason || undefined,
                        }),
                      (r) => {
                        setMessage(r.mode === "moved" ? tm("rescheduledOk") : tm("requestSent"));
                        setMode("none");
                      },
                    )
              }
            >
              {tc("save")}
            </Button>
          </div>
        )}
      </Dialog>

      <ConsentSignDialog
        open={!!consent}
        template={consent}
        patient={{ id: appt.patient.id, nameAr: appt.patient.nameAr }}
        appointmentId={appt.id}
        onClose={() => setConsent(null)}
        onSigned={() => {
          setConsent(null);
          doCheckIn(); // consent signed → continue the check-in
        }}
      />
    </>
  );
}
