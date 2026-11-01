"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, CheckCircle2, Clock } from "lucide-react";
import {
  confirmBookingAction,
  onlineSlotsAction,
  requestBookingCodeAction,
} from "@/app/actions/patient";
import { FormError } from "@/components/clinic/form-message";
import { riyadhParts } from "@/components/clinic/time";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import type { Locale } from "@/i18n/config";
import { formatGregorian, formatSAR } from "@/lib/format";
import type { BookingCatalog } from "@/lib/online/catalog";
import { Choice, Step } from "./choice";

type DoctorChoice =
  { kind: "any" } | { kind: "gender"; gender: "female" | "male" } | { kind: "doctor"; id: string };

type Slot = { startsAt: string; practitionerId: string };

export function OnlineBookingFlow({ catalog, days }: { catalog: BookingCatalog; days: string[] }) {
  const t = useTranslations("book");
  const te = useTranslations("errors");
  const tw = useTranslations("whatsapp");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const errorText = (code: string) => (te.has(code) ? te(code) : te("unexpected"));

  const [branchId, setBranchId] = useState<string | null>(
    catalog.branches.length === 1 ? catalog.branches[0].id : null,
  );
  const [serviceId, setServiceId] = useState<string | null>(null);
  const [doctor, setDoctor] = useState<DoctorChoice | null>(null);
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [details, setDetails] = useState({
    fullName: "",
    phone: "",
    patientGender: "",
    website: "",
    whatsappOptIn: false,
  });
  const [codeStage, setCodeStage] = useState<{ demoCode: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [done, setDone] = useState<{
    status: string;
    startsAt: string;
    practitionerId: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [pending, start] = useTransition();

  const service = catalog.departments.flatMap((d) => d.services).find((s) => s.id === serviceId);
  const branch = catalog.branches.find((b) => b.id === branchId);
  const branchDoctors = useMemo(
    () => catalog.doctors.filter((d) => !d.branchId || d.branchId === branchId),
    [catalog.doctors, branchId],
  );
  const hasGender = (g: "male" | "female") => branchDoctors.some((d) => d.gender === g);
  const doctorName = (id: string) => {
    const d = catalog.doctors.find((x) => x.id === id);
    return d ? name(d) : "";
  };

  // Free times for the chosen day.
  useEffect(() => {
    if (!branchId || !serviceId || !doctor || !day) return;
    let cancelled = false;
    onlineSlotsAction({
      branchId,
      serviceId,
      day,
      practitionerId: doctor.kind === "doctor" ? doctor.id : null,
      gender: doctor.kind === "gender" ? doctor.gender : null,
    }).then((r) => {
      if (cancelled) return;
      if (r.ok) setSlots(r.data);
      else {
        setSlots([]);
        setError(errorText(r.error));
      }
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [branchId, serviceId, doctor, day, reload]);

  /** Changing an earlier step clears everything after it. */
  const reset = (from: "branch" | "service" | "doctor" | "day" | "slot") => {
    setError(null);
    setCodeStage(null);
    setCode("");
    if (from === "branch") setServiceId(null);
    if (["branch", "service"].includes(from)) setDoctor(null);
    if (["branch", "service", "doctor"].includes(from)) setDay(null);
    if (from !== "slot") setSlots(null);
    setSlot(null);
  };

  const request = () => ({
    branchId: branchId!,
    serviceId: serviceId!,
    practitionerId: doctor?.kind === "doctor" ? doctor.id : null,
    gender: doctor?.kind === "gender" ? doctor.gender : null,
    startsAt: slot!.startsAt,
    fullName: details.fullName,
    phone: details.phone,
    patientGender: details.patientGender as "male" | "female",
    website: details.website,
    whatsappOptIn: details.whatsappOptIn,
  });

  const sendCode = () => {
    setError(null);
    start(async () => {
      const r = await requestBookingCodeAction(request());
      if (!r.ok) return setError(errorText(r.error));
      setCodeStage({ demoCode: r.data.demoCode });
      setCode("");
    });
  };

  const confirm = () => {
    setError(null);
    start(async () => {
      const r = await confirmBookingAction({ ...request(), code });
      if (!r.ok) {
        setError(errorText(r.error));
        // The time was taken meanwhile: pick another one (the code still works).
        if (["slot_taken", "already_booked", "too_soon"].includes(r.error)) {
          setSlot(null);
          setSlots(null);
          setReload((x) => x + 1);
        }
        return;
      }
      setDone(r.data);
    });
  };

  const isOpen = (d: string) =>
    !!branchId &&
    (catalog.openWeekdays[branchId] ?? []).includes(new Date(`${d}T12:00:00Z`).getUTCDay()) &&
    !catalog.holidays.some((h) => h.day === d && (!h.branchId || h.branchId === branchId));

  const dayLabel = (d: string) =>
    new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA", {
      weekday: "short",
      day: "numeric",
      month: "short",
      timeZone: "Asia/Riyadh",
    }).format(new Date(`${d}T12:00:00+03:00`));

  if (done) {
    const pendingApproval = done.status === "pending";
    return (
      <div className="bg-card flex flex-col gap-3 rounded-xl border p-5" data-testid="booking-done">
        <div className="text-brand flex items-center gap-2 text-lg font-semibold">
          <CheckCircle2 className="size-6" />
          {pendingApproval ? t("pendingTitle") : t("confirmedTitle")}
        </div>
        <dl className="grid gap-1 text-sm">
          <dd className="font-medium">{service && name(service)}</dd>
          <dd>{doctorName(done.practitionerId)}</dd>
          <dd>
            {formatGregorian(new Date(done.startsAt), locale, "full")} ·{" "}
            <span dir="ltr">{riyadhParts(done.startsAt).time}</span>
          </dd>
          <dd className="text-muted-foreground">{branch && name(branch)}</dd>
        </dl>
        <p className="text-sm">{pendingApproval ? t("pendingText") : t("confirmedText")}</p>
        <Link
          href="/my"
          className="bg-primary text-primary-foreground inline-flex h-10 items-center justify-center rounded-md px-4 text-sm font-medium"
          data-testid="open-my"
        >
          {t("openMy")}
        </Link>
        <Button variant="outline" onClick={() => window.location.reload()}>
          {t("bookAnother")}
        </Button>
      </div>
    );
  }

  let n = 0;
  return (
    <div className="flex flex-col gap-3" data-testid="online-booking">
      {catalog.branches.length > 1 && (
        <Step
          n={++n}
          title={t("stepBranch")}
          done={!!branch}
          summary={branch && name(branch)}
          changeLabel={t("change")}
          onChange={() => {
            setBranchId(null);
            reset("branch");
          }}
          testId="step-branch"
        >
          <div className="grid grid-cols-2 gap-2">
            {catalog.branches.map((b) => (
              <Choice key={b.id} onClick={() => setBranchId(b.id)}>
                <span className="font-medium">{name(b)}</span>
              </Choice>
            ))}
          </div>
        </Step>
      )}

      {branch && (
        <Step
          n={++n}
          title={t("stepService")}
          done={!!service}
          summary={service && name(service)}
          changeLabel={t("change")}
          onChange={() => {
            setServiceId(null);
            reset("service");
          }}
          testId="step-service"
        >
          <div className="flex flex-col gap-4">
            {catalog.departments.map((dep) => (
              <div key={dep.id} className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-xs font-semibold">{name(dep)}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {dep.services.map((s) => (
                    <Choice key={s.id} onClick={() => setServiceId(s.id)} data-service={s.id}>
                      <span className="font-medium">{name(s)}</span>
                      <span className="text-muted-foreground flex flex-wrap gap-x-2 text-xs">
                        <span className="inline-flex items-center gap-1">
                          <Clock className="size-3" />
                          {t("minutes", { n: s.durationMinutes })}
                        </span>
                        {s.priceHalalas !== null && (
                          <span data-testid="price">{formatSAR(s.priceHalalas, locale)}</span>
                        )}
                      </span>
                    </Choice>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Step>
      )}

      {service && (
        <Step
          n={++n}
          title={t("stepDoctor")}
          done={!!doctor}
          summary={
            doctor?.kind === "any"
              ? t("anyDoctor")
              : doctor?.kind === "gender"
                ? t(doctor.gender === "female" ? "femaleDoctor" : "maleDoctor")
                : doctor?.kind === "doctor"
                  ? doctorName(doctor.id)
                  : null
          }
          changeLabel={t("change")}
          onChange={() => {
            setDoctor(null);
            reset("doctor");
          }}
          testId="step-doctor"
        >
          <div className="flex flex-col gap-2">
            <Choice onClick={() => setDoctor({ kind: "any" })} data-testid="doctor-any">
              <span className="font-medium">{t("anyDoctor")}</span>
              <span className="text-muted-foreground text-xs">{t("anyDoctorHint")}</span>
            </Choice>
            <div className="grid grid-cols-2 gap-2">
              {hasGender("female") && (
                <Choice
                  onClick={() => setDoctor({ kind: "gender", gender: "female" })}
                  data-testid="doctor-female"
                >
                  <span className="font-medium">{t("femaleDoctor")}</span>
                </Choice>
              )}
              {hasGender("male") && (
                <Choice
                  onClick={() => setDoctor({ kind: "gender", gender: "male" })}
                  data-testid="doctor-male"
                >
                  <span className="font-medium">{t("maleDoctor")}</span>
                </Choice>
              )}
            </div>
            <p className="text-muted-foreground mt-1 text-xs">{t("orChoose")}</p>
            <div className="grid gap-2 sm:grid-cols-2">
              {branchDoctors.map((d) => (
                <Choice
                  key={d.id}
                  onClick={() => setDoctor({ kind: "doctor", id: d.id })}
                  data-doctor={d.id}
                >
                  <span className="font-medium">{name(d)}</span>
                </Choice>
              ))}
            </div>
          </div>
        </Step>
      )}

      {doctor && (
        <Step
          n={++n}
          title={t("stepDate")}
          done={!!day && !!slot}
          summary={day && slot && `${dayLabel(day)} · ${riyadhParts(slot.startsAt).time}`}
          changeLabel={t("change")}
          onChange={() => {
            setDay(null);
            reset("day");
          }}
          testId="step-date"
        >
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
            {days.map((d) => (
              <Choice
                key={d}
                selected={d === day}
                disabled={!isOpen(d)}
                className="items-center px-1 text-center text-xs"
                onClick={() => {
                  reset("slot");
                  setSlots(null);
                  setDay(d);
                }}
                data-day={d}
              >
                {dayLabel(d)}
              </Choice>
            ))}
          </div>
          {day && (
            <div className="mt-4 flex flex-col gap-2" data-testid="times">
              <h3 className="text-sm font-semibold">{t("stepTime")}</h3>
              {slots === null ? (
                <p className="text-muted-foreground text-sm">{t("loadingTimes")}</p>
              ) : slots.length === 0 ? (
                <p className="text-muted-foreground text-sm" data-testid="no-times">
                  {t("noTimes")}
                </p>
              ) : (
                <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
                  {slots.map((s) => (
                    <Choice
                      key={`${s.startsAt}-${s.practitionerId}`}
                      className="items-center px-1"
                      onClick={() => {
                        setError(null);
                        setSlot(s);
                      }}
                      data-time={riyadhParts(s.startsAt).time}
                    >
                      <span dir="ltr" className="font-medium">
                        {riyadhParts(s.startsAt).time}
                      </span>
                    </Choice>
                  ))}
                </div>
              )}
            </div>
          )}
        </Step>
      )}

      {slot && (
        <Step
          n={++n}
          title={t("stepDetails")}
          done={false}
          changeLabel={t("change")}
          testId="step-details"
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeStage) confirm();
              else sendCode();
            }}
          >
            <Notice tone="info" className="flex items-start gap-2">
              <CalendarCheck className="mt-0.5 size-4 shrink-0" />
              <span>
                {service && name(service)} ·{" "}
                {doctor?.kind === "doctor"
                  ? doctorName(doctor.id)
                  : doctorName(slot.practitionerId)}
                <br />
                {formatGregorian(new Date(slot.startsAt), locale, "full")} ·{" "}
                <span dir="ltr">{riyadhParts(slot.startsAt).time}</span>
              </span>
            </Notice>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="fullName">{t("fullName")}</Label>
              <Input
                id="fullName"
                required
                minLength={3}
                maxLength={80}
                autoComplete="name"
                value={details.fullName}
                disabled={!!codeStage}
                onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">{t("mobile")}</Label>
              <Input
                id="phone"
                required
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder={t("mobileHint")}
                value={details.phone}
                disabled={!!codeStage}
                onChange={(e) => setDetails({ ...details, phone: e.target.value })}
              />
            </div>
            <fieldset className="flex flex-col gap-1.5" disabled={!!codeStage}>
              <legend className="mb-1.5 text-sm font-medium">{t("yourGender")}</legend>
              <div className="grid grid-cols-2 gap-2">
                {(["female", "male"] as const).map((g) => (
                  <label
                    key={g}
                    className="border-input has-[:checked]:border-brand has-[:checked]:bg-brand/10 flex h-10 cursor-pointer items-center gap-2 rounded-md border px-3 text-sm"
                  >
                    <input
                      type="radio"
                      name="patientGender"
                      value={g}
                      required
                      checked={details.patientGender === g}
                      onChange={() => setDetails({ ...details, patientGender: g })}
                    />
                    {t(g)}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-brand mt-0.5 size-4 shrink-0"
                checked={details.whatsappOptIn}
                disabled={!!codeStage}
                onChange={(e) => setDetails({ ...details, whatsappOptIn: e.target.checked })}
                data-testid="whatsapp-opt-in"
              />
              {tw("optInLabel")}
            </label>
            {/* Honeypot: invisible to people, bots fill it in. */}
            <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
              <label htmlFor="website">{t("website")}</label>
              <input
                id="website"
                name="website"
                tabIndex={-1}
                autoComplete="off"
                value={details.website}
                onChange={(e) => setDetails({ ...details, website: e.target.value })}
              />
            </div>

            {codeStage && (
              <div className="flex flex-col gap-1.5" data-testid="code-step">
                <p className="text-sm">{t("codeSent")}</p>
                {codeStage.demoCode && (
                  <Notice tone="info" data-testid="demo-code">
                    {t("demoCode", { code: codeStage.demoCode })}
                  </Notice>
                )}
                <Label htmlFor="code">{t("code")}</Label>
                <Input
                  id="code"
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  dir="ltr"
                  maxLength={6}
                  pattern="[0-9٠-٩]{6}"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                />
              </div>
            )}

            <FormError message={error} />
            <Button
              type="submit"
              disabled={pending}
              data-testid={codeStage ? "confirm" : "send-code"}
            >
              {codeStage ? t("confirm") : t("sendCode")}
            </Button>
            {codeStage && (
              <Button type="button" variant="ghost" disabled={pending} onClick={sendCode}>
                {t("resend")}
              </Button>
            )}
          </form>
        </Step>
      )}
    </div>
  );
}
