"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Building2, CalendarCheck, CheckCircle2, Clock, Video } from "lucide-react";
import {
  confirmBookingAction,
  onlineSlotsAction,
  requestPhoneCodeAction,
  verifyBookingPhoneAction,
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

type Slot = { startsAt: string; practitionerId: string; branchId: string };
type Mode = "clinic" | "video";

export interface BookingIdentity {
  phone: string;
  known: { fullName: string; gender: "male" | "female" | null } | null;
}

/**
 * Online booking. Step 1 is the patient's mobile + a code (OTP); after that they choose the visit
 * type, service, doctor and time, and confirm with one tap (no second code).
 */
export function OnlineBookingFlow({
  catalog,
  days,
  identity,
  initial,
}: {
  catalog: BookingCatalog;
  days: string[];
  /** Already verified in this browser (pass cookie or signed-in patient). */
  identity: BookingIdentity | null;
  /** From the clinic website: a chosen visit type or service. */
  initial?: { mode?: "clinic" | "video"; serviceId?: string; doctorId?: string };
}) {
  const t = useTranslations("book");
  const te = useTranslations("errors");
  const tw = useTranslations("whatsapp");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const errorText = (code: string) => (te.has(code) ? te(code) : te("unexpected"));

  const allServices = catalog.departments.flatMap((d) => d.services);
  /** Video consultations are offered when a video service and a branch with a video room exist. */
  const offersVideo = catalog.videoBranches.length > 0 && allServices.some((s) => s.isVirtual);
  const initialService = allServices.find((s) => s.id === initial?.serviceId);
  /** Chosen on the website ("Book with this doctor"): picked once a service is chosen. */
  const wantedDoctor = catalog.doctors.find((d) => d.id === initial?.doctorId) ?? null;
  const [mode, setMode] = useState<Mode | null>(
    wantedDoctor && !initialService && !initial?.mode
      ? "clinic"
      : initialService
        ? initialService.isVirtual
          ? "video"
          : "clinic"
        : offersVideo
          ? (initial?.mode ?? null)
          : "clinic",
  );
  const [branchId, setBranchId] = useState<string | null>(
    catalog.branches.length === 1
      ? catalog.branches[0].id
      : wantedDoctor?.branchId && catalog.branches.some((b) => b.id === wantedDoctor.branchId)
        ? wantedDoctor.branchId
        : null,
  );
  const [serviceId, setServiceId] = useState<string | null>(
    initialService &&
      (initialService.isVirtual ||
        catalog.branches.length === 1 ||
        (wantedDoctor?.branchId && !initialService.isVirtual))
      ? initialService.id
      : null,
  );
  /** Chosen on the website for a clinic visit: picked once a branch is chosen. */
  const [wantedService] = useState(
    initialService && !initialService.isVirtual ? initialService.id : null,
  );
  const [verified, setVerified] = useState<BookingIdentity | null>(identity);
  const [phoneInput, setPhoneInput] = useState("");
  const [doctor, setDoctor] = useState<DoctorChoice | null>(
    wantedDoctor && initialService ? { kind: "doctor", id: wantedDoctor.id } : null,
  );
  const [day, setDay] = useState<string | null>(null);
  const [slot, setSlot] = useState<Slot | null>(null);
  const [slots, setSlots] = useState<Slot[] | null>(null);
  const [details, setDetails] = useState({
    fullName: identity?.known?.fullName ?? "",
    phone: identity?.phone ?? "",
    patientGender: (identity?.known?.gender ?? "") as string,
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

  const service = allServices.find((s) => s.id === serviceId);
  const branch = catalog.branches.find((b) => b.id === branchId);
  /**
   * Where to look for times: the chosen branch, or — for video — every branch that offers video
   * (the patient stays at home, so the branch doesn't matter to them).
   */
  const searchBranches = useMemo(
    () => (mode === "video" ? catalog.videoBranches : branchId ? [branchId] : []),
    [mode, branchId, catalog.videoBranches],
  );
  const branchDoctors = useMemo(
    () => catalog.doctors.filter((d) => !d.branchId || searchBranches.includes(d.branchId)),
    [catalog.doctors, searchBranches],
  );
  const departments = catalog.departments
    .map((dep) => ({
      ...dep,
      services: dep.services.filter((s) => s.isVirtual === (mode === "video")),
    }))
    .filter((dep) => dep.services.length > 0);
  const hasGender = (g: "male" | "female") => branchDoctors.some((d) => d.gender === g);
  const doctorName = (id: string) => {
    const d = catalog.doctors.find((x) => x.id === id);
    return d ? name(d) : "";
  };

  // Free times for the chosen day (for video: from every video branch, merged).
  useEffect(() => {
    if (!searchBranches.length || !serviceId || !doctor || !day) return;
    let cancelled = false;
    const chosen =
      doctor.kind === "doctor" ? catalog.doctors.find((d) => d.id === doctor.id) : null;
    const where = chosen?.branchId
      ? searchBranches.filter((b) => b === chosen.branchId)
      : searchBranches;
    Promise.all(
      where.map((b) =>
        onlineSlotsAction({
          branchId: b,
          serviceId,
          day,
          practitionerId: doctor.kind === "doctor" ? doctor.id : null,
          gender: doctor.kind === "gender" ? doctor.gender : null,
        }).then((r) => ({ b, r })),
      ),
    ).then((results) => {
      if (cancelled) return;
      const failed = results.find((x) => !x.r.ok);
      if (failed && !failed.r.ok) {
        setSlots([]);
        setError(errorText(failed.r.error));
        return;
      }
      // One button per time: the first doctor free then.
      const seen = new Set<string>();
      const merged = results
        .flatMap((x) => (x.r.ok ? x.r.data.map((s) => ({ ...s, branchId: x.b })) : []))
        .sort((a, z) => a.startsAt.localeCompare(z.startsAt))
        .filter((s) => {
          if (seen.has(s.startsAt)) return false;
          seen.add(s.startsAt);
          return true;
        });
      setSlots(merged);
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchBranches, serviceId, doctor, day, reload]);

  /**
   * Choose a service. "Book with this doctor" from the website: the doctor is chosen too when
   * they work where the patient is booking (they can still change the doctor afterwards).
   */
  const chooseService = (id: string, where: string[]) => {
    setServiceId(id);
    if (wantedDoctor && (!wantedDoctor.branchId || where.includes(wantedDoctor.branchId)))
      setDoctor({ kind: "doctor", id: wantedDoctor.id });
  };

  /** Changing an earlier step clears everything after it. */
  const reset = (from: "mode" | "branch" | "service" | "doctor" | "day" | "slot") => {
    setError(null);
    if (from === "mode" || from === "branch") setServiceId(null);
    if (["mode", "branch", "service"].includes(from)) setDoctor(null);
    if (["mode", "branch", "service", "doctor"].includes(from)) setDay(null);
    if (from !== "slot") setSlots(null);
    setSlot(null);
  };

  const request = () => ({
    branchId: slot!.branchId,
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

  /** Step 1: a code to the mobile… */
  const sendCode = () => {
    setError(null);
    start(async () => {
      const r = await requestPhoneCodeAction({ phone: phoneInput, website: details.website });
      if (!r.ok) return setError(errorText(r.error));
      setCodeStage({ demoCode: r.data.demoCode });
      setCode("");
    });
  };

  /** …then the code: the mobile is verified for this booking (no second code later). */
  const verifyCode = () => {
    setError(null);
    start(async () => {
      const r = await verifyBookingPhoneAction({ phone: phoneInput, code });
      if (!r.ok) return setError(errorText(r.error));
      setVerified(r.data);
      setCodeStage(null);
      setDetails((d) => ({
        ...d,
        phone: r.data.phone,
        fullName: r.data.known?.fullName ?? d.fullName,
        patientGender: r.data.known?.gender ?? d.patientGender,
      }));
    });
  };

  const confirm = () => {
    setError(null);
    start(async () => {
      const r = await confirmBookingAction(request());
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
    searchBranches.some(
      (b) =>
        ((catalog.openWeekdays[b] ?? []).includes(new Date(`${d}T12:00:00Z`).getUTCDay()) ||
          catalog.extraDays.some((x) => x.day === d && x.branchId === b)) &&
        !catalog.holidays.some((h) => h.day === d && (!h.branchId || h.branchId === b)),
    );

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
        <div className="text-brand-strong flex items-center gap-2 text-lg font-semibold">
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
          <dd className="text-muted-foreground">
            {mode === "video" ? t("videoDone") : branch && name(branch)}
          </dd>
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

  // Step 1 (before anything else): the mobile number and its code.
  if (!verified) {
    return (
      <div className="flex flex-col gap-3" data-testid="online-booking">
        <Step
          n={1}
          title={t("stepMobile")}
          done={false}
          changeLabel={t("change")}
          testId="step-mobile"
        >
          <form
            className="flex flex-col gap-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (codeStage) verifyCode();
              else sendCode();
            }}
          >
            <p className="text-muted-foreground text-sm">{t("mobileFirst")}</p>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="phone">{t("mobile")}</Label>
              <Input
                id="phone"
                required
                inputMode="tel"
                autoComplete="tel"
                dir="ltr"
                placeholder={t("mobileHint")}
                value={phoneInput}
                disabled={!!codeStage}
                onChange={(e) => setPhoneInput(e.target.value)}
              />
            </div>
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
                  className="font-mono tracking-[0.3em]"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  autoFocus
                />
              </div>
            )}
            <FormError message={error} />
            <Button
              type="submit"
              size="lg"
              loading={pending}
              data-testid={codeStage ? "verify-code" : "send-code"}
            >
              {codeStage ? t("verifyCode") : t("sendCode")}
            </Button>
            {codeStage && (
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={sendCode}
                >
                  {t("resend")}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setCodeStage(null);
                    setCode("");
                  }}
                >
                  {t("changeMobile")}
                </Button>
              </div>
            )}
          </form>
        </Step>
      </div>
    );
  }

  let n = 1;
  const pickService = mode === "video" ? true : !!branch;
  return (
    <div className="flex flex-col gap-3" data-testid="online-booking">
      <Step
        n={1}
        title={t("stepMobile")}
        done
        summary={
          <span dir="ltr" className="font-mono">
            {verified.phone}
          </span>
        }
        changeLabel={t("change")}
        onChange={() => {
          setVerified(null);
          setPhoneInput("");
        }}
        testId="step-mobile"
      />
      {offersVideo && (
        <Step
          n={++n}
          title={t("stepMode")}
          done={!!mode}
          summary={mode && (mode === "video" ? t("modeVideo") : t("modeClinic"))}
          changeLabel={t("change")}
          onChange={() => {
            setMode(null);
            reset("mode");
          }}
          testId="step-mode"
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <Choice onClick={() => setMode("clinic")} data-testid="mode-clinic">
              <span className="flex items-center gap-2 font-medium">
                <Building2 className="text-brand-strong size-5" />
                {t("modeClinic")}
              </span>
              <span className="text-muted-foreground text-xs">{t("modeClinicHint")}</span>
            </Choice>
            <Choice
              onClick={() => {
                setMode("video");
                // Only one video service: choose it straight away.
                const video = allServices.filter((s) => s.isVirtual);
                if (video.length === 1) chooseService(video[0].id, catalog.videoBranches);
              }}
              data-testid="mode-video"
            >
              <span className="flex items-center gap-2 font-medium">
                <Video className="text-brand-strong size-5" />
                {t("modeVideo")}
              </span>
              <span className="text-muted-foreground text-xs">{t("modeVideoHint")}</span>
            </Choice>
          </div>
        </Step>
      )}

      {mode === "clinic" && catalog.branches.length > 1 && (
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
              <Choice
                key={b.id}
                onClick={() => {
                  setBranchId(b.id);
                  if (wantedService) chooseService(wantedService, [b.id]);
                }}
              >
                <span className="font-medium">{name(b)}</span>
              </Choice>
            ))}
          </div>
        </Step>
      )}

      {mode && pickService && (
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
            {departments.map((dep) => (
              <div key={dep.id} className="flex flex-col gap-2">
                <h3 className="text-muted-foreground text-xs font-semibold">{name(dep)}</h3>
                <div className="grid gap-2 sm:grid-cols-2">
                  {dep.services.map((s) => (
                    <Choice
                      key={s.id}
                      onClick={() => chooseService(s.id, searchBranches)}
                      data-service={s.id}
                    >
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
              confirm();
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
                onChange={(e) => setDetails({ ...details, fullName: e.target.value })}
              />
            </div>
            <p
              className="text-muted-foreground flex items-center gap-1.5 text-sm"
              data-testid="verified-phone"
            >
              <CheckCircle2 className="text-success-foreground size-4" />
              {t("verifiedMobile")}{" "}
              <span dir="ltr" className="font-mono">
                {details.phone}
              </span>
            </p>
            <fieldset className="flex flex-col gap-1.5">
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

            <FormError message={error} />
            <Button type="submit" size="lg" loading={pending} data-testid="confirm">
              {t("confirm")}
            </Button>
          </form>
        </Step>
      )}
    </div>
  );
}
