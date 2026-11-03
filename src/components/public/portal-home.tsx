"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { CalendarPlus, FileSignature, Layers, LogOut } from "lucide-react";
import {
  portalCancelAction,
  portalMoveAction,
  portalSignConsentAction,
  portalSignOutAction,
  portalSlotsAction,
  portalWhatsappAction,
} from "@/app/actions/patient";
import { StatusBadge } from "@/components/clinic/badges";
import { FormError, FormSuccess } from "@/components/clinic/form-message";
import { SignaturePad, type SignaturePadHandle } from "@/components/clinic/signature-pad";
import { riyadhParts, todayRiyadh } from "@/components/clinic/time";
import { ConsentReason } from "@/components/clinic/consent-reason";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/config";
import { formatGregorian } from "@/lib/format";
import type { PortalData } from "@/lib/portal/data";
import { Choice } from "./choice";

type Appt = PortalData["upcoming"][number];
type Doctor = { nameAr: string; nameEn: string | null } | null;
type SlotOptions =
  | { ok: false; reason: string }
  | {
      ok: true;
      doctor: Doctor;
      sameDoctor: string[];
      otherDoctors: { practitionerId: string; doctor: Doctor; slots: string[] }[];
    };

function useRun() {
  const te = useTranslations("errors");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const run = <T,>(
    fn: () => Promise<{ ok: true; data: T } | { ok: false; error: string }>,
    ok?: (d: T) => void,
  ) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) {
        setError(te.has(r.error) ? te(r.error) : te("unexpected"));
        if (r.error === "patient_signed_out") router.refresh();
        return;
      }
      ok?.(r.data);
      router.refresh();
    });
  };
  return { run, pending, error };
}

export function PortalHome({ data }: { data: PortalData }) {
  const t = useTranslations("my");
  const locale = useLocale() as Locale;
  const pick = (ar: string, en: string | null) => (locale === "en" && en ? en : ar);
  const personName = (id: string) => {
    const p = data.family.find((f) => f.id === id);
    return p ? pick(p.nameAr, p.nameEn) : "";
  };
  const { run, pending } = useRun();
  const me = data.me!;
  const date = (iso: string) => formatGregorian(new Date(iso), locale, "medium");

  return (
    <div className="flex flex-col gap-4" data-testid="portal-home">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold">{t("hello", { name: pick(me.nameAr, me.nameEn) })}</h1>
          <p className="text-muted-foreground text-sm" dir="ltr">
            {me.fileNumber}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={pending}
          onClick={() => run(() => portalSignOutAction())}
          data-testid="sign-out"
        >
          <LogOut />
          {t("signOut")}
        </Button>
      </div>

      <WhatsAppSwitch on={!!me.whatsappOptInAt && !me.whatsappOptedOutAt} />

      {data.pendingConsents.length > 0 && (
        <section className="flex flex-col gap-2" data-testid="consents-to-sign">
          <h2 className="font-semibold">{t("toSign")}</h2>
          <p className="text-muted-foreground text-sm">{t("toSignHint")}</p>
          {data.pendingConsents.map((c) => (
            <ConsentToSign
              key={`${c.patientId}-${c.templateId}`}
              consent={c}
              personName={personName(c.patientId)}
              isMe={c.patientId === me.id}
            />
          ))}
        </section>
      )}

      <section className="flex flex-col gap-2" data-testid="upcoming">
        <div className="flex items-center justify-between gap-2">
          <h2 className="font-semibold">{t("upcoming")}</h2>
          <Link
            href="/book"
            className="text-brand inline-flex items-center gap-1 text-sm font-medium"
          >
            <CalendarPlus className="size-4" />
            {t("bookNew")}
          </Link>
        </div>
        {data.upcoming.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noUpcoming")}</p>
        )}
        {data.upcoming.map((a) => (
          <AppointmentCard
            key={a.id}
            a={a}
            forName={a.patientId !== me.id ? personName(a.patientId) : null}
            horizonDays={data.horizonDays}
            windowHours={data.cancellationWindowHours}
          />
        ))}
        {data.upcoming.length > 0 && (
          <p className="text-muted-foreground text-xs">
            {t("changeWindow", { hours: data.cancellationWindowHours })}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2" data-testid="packages">
        <h2 className="font-semibold">{t("packages")}</h2>
        {data.packages.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noPackages")}</p>
        )}
        {data.packages.map((p) => (
          <div key={p.id} className="bg-card flex items-center gap-3 rounded-xl border p-3 text-sm">
            <Layers className="text-brand size-5 shrink-0" />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{pick(p.nameAr, p.nameEn)}</div>
              <div className="text-muted-foreground text-xs">
                {p.patientId !== me.id && `${t("forPerson", { name: personName(p.patientId) })} · `}
                {t("validUntil", { date: date(p.expiresAt) })}
              </div>
            </div>
            <div className="text-end text-xs font-semibold" data-testid="package-balance">
              {t("sessionsLeft", { remaining: p.remaining, total: p.total })}
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2" data-testid="signed-consents">
        <h2 className="font-semibold">{t("signedConsents")}</h2>
        {data.signed.length === 0 && (
          <p className="text-muted-foreground text-sm">{t("noConsents")}</p>
        )}
        {data.signed.map((c) => (
          <div key={c.id} className="bg-card flex items-start gap-3 rounded-xl border p-3 text-sm">
            <FileSignature className="text-brand mt-0.5 size-5 shrink-0" />
            <div className="min-w-0">
              <div className="font-medium">
                {pick(c.titleAr, c.titleEn)}{" "}
                <span className="text-muted-foreground text-xs">v{c.version}</span>
              </div>
              <div className="text-muted-foreground text-xs">
                {c.patientId !== me.id && `${t("forPerson", { name: personName(c.patientId) })} · `}
                {t("signedOn", { date: date(c.signedAt) })} ·{" "}
                {c.signedVia === "patient_portal" ? t("viaPortal") : t("viaClinic")}
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-2" data-testid="past">
        <h2 className="font-semibold">{t("past")}</h2>
        {data.past.length === 0 && <p className="text-muted-foreground text-sm">{t("noPast")}</p>}
        {data.past.map((a) => (
          <AppointmentCard
            key={a.id}
            a={{ ...a, canChange: false }}
            forName={a.patientId !== me.id ? personName(a.patientId) : null}
            horizonDays={data.horizonDays}
            windowHours={data.cancellationWindowHours}
            muted
          />
        ))}
      </section>
    </div>
  );
}

function AppointmentCard({
  a,
  forName,
  horizonDays,
  muted,
  windowHours,
}: {
  a: Appt;
  forName: string | null;
  horizonDays: number;
  windowHours: number;
  muted?: boolean;
}) {
  const t = useTranslations("my");
  const tb = useTranslations("book");
  const ts = useTranslations("statuses");
  const locale = useLocale() as Locale;
  const pick = (ar: string, en: string | null) => (locale === "en" && en ? en : ar);
  const [mode, setMode] = useState<"none" | "cancel" | "move">("none");
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useRun();
  const [day, setDay] = useState<string | null>(null);
  const [options, setOptions] = useState<SlotOptions | null>(null);
  const te = useTranslations("errors");
  const loadDay = (d: string) => {
    setDay(d);
    setOptions(null);
    portalSlotsAction({ appointmentId: a.id, day: d }).then((r) => {
      if (!r.ok) {
        // A real problem (e.g. signed out after 30 minutes) — say so, never "all full".
        setOptions({ ok: false, reason: te.has(r.error) ? te(r.error) : te("unexpected") });
        return;
      }
      if (!r.data.ok) {
        setOptions({
          ok: false,
          reason: t(`refusal.${r.data.reason}`, { hours: r.data.hours ?? windowHours }),
        });
        return;
      }
      setOptions(r.data);
    });
  };
  const move = (startsAt: string, practitionerId?: string) =>
    run(
      () => portalMoveAction({ appointmentId: a.id, startsAt, practitionerId }),
      () => {
        setMode("none");
        setMsg(t("moved"));
      },
    );
  const today = todayRiyadh();
  const days = Array.from({ length: Math.min(horizonDays, 30) + 1 }, (_, i) => {
    const d = new Date(`${today}T12:00:00+03:00`);
    d.setUTCDate(d.getUTCDate() + i);
    return riyadhParts(d.toISOString()).day;
  });

  return (
    <div
      className={`bg-card flex flex-col gap-2 rounded-xl border p-3 text-sm ${muted ? "opacity-75" : ""}`}
      data-testid="portal-appointment"
      data-status={a.status}
      data-appointment={a.id}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{pick(a.serviceAr, a.serviceEn)}</div>
          <div>
            {formatGregorian(new Date(a.startsAt), locale, "full")} ·{" "}
            <span dir="ltr" className="font-medium">
              {riyadhParts(a.startsAt).time}
            </span>
          </div>
          <div className="text-muted-foreground text-xs">
            {pick(a.doctorAr, a.doctorEn)} · {pick(a.branchAr, a.branchEn)}
            {forName && ` · ${t("forPerson", { name: forName })}`}
          </div>
        </div>
        <StatusBadge status={a.status} label={ts(a.status)} />
      </div>
      <FormSuccess message={msg} />
      <FormError message={error} />
      {!muted && a.canChange && mode === "none" && (
        <div className="flex flex-wrap gap-2">
          {a.canReschedule && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => setMode("move")}
              data-testid="portal-reschedule"
            >
              {t("reschedule")}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => setMode("cancel")}
            data-testid="portal-cancel"
          >
            {t("cancel")}
          </Button>
        </div>
      )}
      {!muted && !a.canChange && (
        <p className="text-muted-foreground text-xs" data-testid="portal-too-late">
          {t("refusal.outside_window", { hours: windowHours })}
        </p>
      )}
      {!muted && a.canChange && !a.canReschedule && (
        <p className="text-muted-foreground text-xs" data-testid="portal-not-online">
          {t("refusal.not_online")}
        </p>
      )}
      {mode === "cancel" && (
        <div className="bg-muted flex flex-col gap-2 rounded-md p-3">
          <p>{t("cancelConfirm")}</p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="destructive"
              disabled={pending}
              data-testid="portal-cancel-confirm"
              onClick={() =>
                run(
                  () => portalCancelAction({ appointmentId: a.id }),
                  () => {
                    setMode("none");
                    setMsg(t("cancelled"));
                  },
                )
              }
            >
              {t("yesCancel")}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setMode("none")}>
              {t("keep")}
            </Button>
          </div>
        </div>
      )}
      {mode === "move" && (
        <div className="bg-muted flex flex-col gap-2 rounded-md p-3" data-testid="portal-move">
          <p className="text-sm font-medium">{t("pickNewTime")}</p>
          <div className="grid grid-cols-4 gap-1.5">
            {days.map((d) => (
              <Choice
                key={d}
                selected={d === day}
                className="items-center px-1 text-center text-xs"
                data-day={d}
                onClick={() => loadDay(d)}
              >
                {new Intl.DateTimeFormat(locale === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-SA", {
                  weekday: "short",
                  day: "numeric",
                  month: "short",
                  timeZone: "Asia/Riyadh",
                }).format(new Date(`${d}T12:00:00+03:00`))}
              </Choice>
            ))}
          </div>
          {day && !options && <p className="text-muted-foreground text-sm">{tb("loadingTimes")}</p>}
          {day && options && !options.ok && (
            <p
              className="bg-warning text-warning-foreground rounded-md px-3 py-2 text-sm"
              data-testid="move-refusal"
            >
              {options.reason}
            </p>
          )}
          {day && options?.ok && (
            <div className="flex flex-col gap-3" data-testid="move-options">
              {options.sameDoctor.length > 0 ? (
                <div className="grid grid-cols-4 gap-1.5" data-testid="same-doctor-times">
                  {options.sameDoctor.map((s) => (
                    <Choice
                      key={s}
                      className="items-center"
                      disabled={pending}
                      data-time={riyadhParts(s).time}
                      onClick={() => move(s)}
                    >
                      <span dir="ltr">{riyadhParts(s).time}</span>
                    </Choice>
                  ))}
                </div>
              ) : (
                <p className="text-sm" data-testid="doctor-full">
                  {t("doctorFull", {
                    doctor: options.doctor
                      ? pick(options.doctor.nameAr, options.doctor.nameEn)
                      : "",
                  })}
                </p>
              )}
              {options.otherDoctors.length > 0 && (
                <div className="flex flex-col gap-2" data-testid="other-doctors">
                  <p className="text-muted-foreground text-xs">{t("otherDoctors")}</p>
                  {options.otherDoctors.map((d) => (
                    <div key={d.practitionerId} className="flex flex-col gap-1">
                      <span className="text-xs font-medium">
                        {d.doctor ? pick(d.doctor.nameAr, d.doctor.nameEn) : ""}
                      </span>
                      <div className="grid grid-cols-4 gap-1.5">
                        {d.slots.map((s) => (
                          <Choice
                            key={s}
                            className="items-center"
                            disabled={pending}
                            data-time={riyadhParts(s).time}
                            data-doctor={d.practitionerId}
                            onClick={() => move(s, d.practitionerId)}
                          >
                            <span dir="ltr">{riyadhParts(s).time}</span>
                          </Choice>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              {options.sameDoctor.length === 0 && options.otherDoctors.length === 0 && (
                <p className="text-muted-foreground text-sm" data-testid="nobody-free">
                  {t("nobodyFree")}
                </p>
              )}
            </div>
          )}
          <Button size="sm" variant="ghost" className="self-start" onClick={() => setMode("none")}>
            {t("keep")}
          </Button>
        </div>
      )}
    </div>
  );
}

function ConsentToSign({
  consent,
  personName,
  isMe,
}: {
  consent: PortalData["pendingConsents"][number];
  personName: string;
  isMe: boolean;
}) {
  const t = useTranslations("my");
  const tc = useTranslations("consent");
  const locale = useLocale() as Locale;
  const [open, setOpen] = useState(false);
  const [signer, setSigner] = useState(personName);
  const [agree, setAgree] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);
  const { run, pending, error } = useRun();
  const title = locale === "en" ? consent.titleEn : consent.titleAr;
  const body = locale === "en" ? consent.bodyEn : consent.bodyAr;
  const other = locale === "en" ? consent.bodyAr : consent.bodyEn;

  return (
    <div
      className="bg-card flex flex-col gap-2 rounded-xl border p-3 text-sm"
      data-testid="consent-to-sign"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="font-semibold">{title}</div>
          <div className="text-muted-foreground text-xs">
            {tc("version", { version: consent.version })}
            {!isMe && ` · ${t("forPerson", { name: personName })}`}
          </div>
          <div className="text-muted-foreground text-xs">
            <ConsentReason reason={consent.reason} />
          </div>
        </div>
        {!open && (
          <Button size="sm" onClick={() => setOpen(true)} data-testid="sign-consent">
            {tc("signNow")}
          </Button>
        )}
      </div>
      <FormSuccess message={msg} />
      {open && (
        <div className="flex flex-col gap-3">
          <div
            className="bg-muted max-h-72 overflow-y-auto rounded-md border p-3 leading-7 whitespace-pre-line"
            data-testid="consent-text"
          >
            {body}
            <details className="mt-3">
              <summary className="text-muted-foreground cursor-pointer text-xs">
                {locale === "en" ? "النص العربي" : tc("englishText")}
              </summary>
              <div dir={locale === "en" ? "rtl" : "ltr"} className="mt-2 whitespace-pre-line">
                {other}
              </div>
            </details>
          </div>
          {!isMe && <p className="text-xs">{t("signFor", { name: personName })}</p>}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`signer-${consent.templateId}-${consent.patientId}`}>
              {tc("signerName")}
            </Label>
            <Input
              id={`signer-${consent.templateId}-${consent.patientId}`}
              value={signer}
              onChange={(e) => setSigner(e.target.value)}
            />
          </div>
          <SignaturePad ref={pad} clearLabel={tc("clear")} hint={tc("signatureHint")} />
          <label className="flex items-start gap-2">
            <input
              type="checkbox"
              className="accent-brand mt-0.5 size-4"
              checked={agree}
              onChange={(e) => setAgree(e.target.checked)}
              data-testid="consent-agree"
            />
            {t("agree")}
          </label>
          <FormError message={error} />
          <Button
            disabled={pending || !agree}
            data-testid="consent-submit"
            onClick={() => {
              const png = pad.current?.toPng();
              if (!png) return run(async () => ({ ok: false as const, error: "bad_signature" }));
              run(
                () =>
                  portalSignConsentAction({
                    patientId: consent.patientId,
                    templateId: consent.templateId,
                    appointmentId: consent.appointmentId,
                    signerName: signer,
                    signatureDataUrl: png,
                  }),
                () => {
                  setOpen(false);
                  setMsg(t("signedOk"));
                },
              );
            }}
          >
            {tc("submit")}
          </Button>
        </div>
      )}
    </div>
  );
}

function WhatsAppSwitch({ on }: { on: boolean }) {
  const t = useTranslations("whatsapp");
  const { run, pending, error } = useRun();
  return (
    <section
      className="bg-card flex flex-wrap items-center justify-between gap-2 rounded-xl border p-3 text-sm"
      data-testid="my-whatsapp"
      data-on={on}
    >
      <div>
        <div className="font-semibold">{t("myOptInTitle")}</div>
        <div className="text-muted-foreground">{on ? t("myOptInOn") : t("myOptInOff")}</div>
      </div>
      <Button
        size="sm"
        variant={on ? "outline" : "default"}
        disabled={pending}
        onClick={() => run(() => portalWhatsappAction({ optIn: !on }))}
        data-testid="my-whatsapp-toggle"
      >
        {on ? t("myTurnOff") : t("myTurnOn")}
      </Button>
      <FormError message={error} />
    </section>
  );
}
