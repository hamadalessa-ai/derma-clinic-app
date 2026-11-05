"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, Copy, Download } from "lucide-react";
import {
  setMemberGenderAction,
  setServiceOnlineAction,
  updateSettingsAction,
} from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export interface OnlineSettingsValues {
  onlineBookingEnabled: boolean;
  onlineHorizonDays: number;
  onlineMinNoticeMinutes: number;
  cancellationWindowHours: number;
  onlineRequiresApproval: boolean;
  showPricesOnline: boolean;
}

function Toggle({
  label,
  hint,
  checked,
  onChange,
  testId,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  testId?: string;
}) {
  return (
    <label className="flex items-start gap-3">
      <input
        type="checkbox"
        className="accent-brand mt-0.5 size-5 shrink-0"
        checked={checked}
        data-testid={testId}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span className="flex flex-col gap-0.5">
        <span className="font-medium">{label}</span>
        {hint && <span className="text-muted-foreground text-sm">{hint}</span>}
      </span>
    </label>
  );
}

/** Online booking rules: on/off, horizon, notice, cancellation window, approval, prices. */
export function OnlineSettingsForm({ initial }: { initial: OnlineSettingsValues }) {
  const t = useTranslations("settings");
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const num =
    (k: "onlineHorizonDays" | "cancellationWindowHours") =>
    (e: React.ChangeEvent<HTMLInputElement>) =>
      setV({ ...v, [k]: Number(e.target.value) });
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        run(
          () => updateSettingsAction(v),
          () => setMsg(t("savedOk")),
        );
      }}
    >
      <Toggle
        label={t("onlineEnabled")}
        hint={t("onlineEnabledHint")}
        checked={v.onlineBookingEnabled}
        onChange={(x) => setV({ ...v, onlineBookingEnabled: x })}
        testId="online-enabled"
      />
      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="horizon">{t("horizonDays")}</Label>
          <Input
            id="horizon"
            type="number"
            min={1}
            max={180}
            value={v.onlineHorizonDays}
            onChange={num("onlineHorizonDays")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="notice">{t("minNoticeHours")}</Label>
          <Input
            id="notice"
            type="number"
            min={0}
            max={168}
            step={0.5}
            value={v.onlineMinNoticeMinutes / 60}
            onChange={(e) =>
              setV({ ...v, onlineMinNoticeMinutes: Math.round(Number(e.target.value) * 60) })
            }
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cancelWindow">{t("cancelWindowHours")}</Label>
          <Input
            id="cancelWindow"
            type="number"
            min={0}
            max={336}
            value={v.cancellationWindowHours}
            onChange={num("cancellationWindowHours")}
          />
        </div>
      </div>
      <Toggle
        label={t("requiresApproval")}
        hint={t("requiresApprovalHint")}
        checked={v.onlineRequiresApproval}
        onChange={(x) => setV({ ...v, onlineRequiresApproval: x })}
        testId="requires-approval"
      />
      <Toggle
        label={t("showPrices")}
        hint={t("showPricesHint")}
        checked={v.showPricesOnline}
        onChange={(x) => setV({ ...v, showPricesOnline: x })}
        testId="show-prices"
      />
      <FormError message={error} />
      <FormSuccess message={msg} />
      <Button type="submit" className="self-start" disabled={pending} data-testid="save-online">
        {t("save")}
      </Button>
    </form>
  );
}

/** Which services patients may book online. Saves on each tap. */
export function OnlineServicesList({
  services,
}: {
  services: { id: string; nameAr: string; nameEn: string; onlineBookable: boolean }[];
}) {
  const t = useTranslations("settings");
  const locale = useLocale();
  const [on, setOn] = useState(
    () => new Set(services.filter((s) => s.onlineBookable).map((s) => s.id)),
  );
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{t("onlineServicesHint")}</p>
      <ul className="grid gap-x-4 gap-y-2 sm:grid-cols-2">
        {services.map((s) => (
          <li key={s.id}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="accent-brand size-4"
                checked={on.has(s.id)}
                disabled={pending}
                data-service-online={s.id}
                onChange={(e) => {
                  const value = e.target.checked;
                  const next = new Set(on);
                  if (value) next.add(s.id);
                  else next.delete(s.id);
                  setOn(next);
                  run(() => setServiceOnlineAction({ serviceId: s.id, online: value }));
                }}
              />
              {locale === "en" ? s.nameEn : s.nameAr}
            </label>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

/** Doctors' gender (for "female / male doctor" on the booking page). */
export function StaffGenderList({
  doctors,
}: {
  doctors: { id: string; name: string; gender: "male" | "female" | null }[];
}) {
  const t = useTranslations("settings");
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col divide-y">
        {doctors.map((d) => (
          <li key={d.id} className="flex items-center justify-between gap-3 py-2">
            <span className="min-w-0 truncate text-sm">{d.name}</span>
            <Select
              aria-label={`${t("gender")} — ${d.name}`}
              className="w-32 shrink-0"
              defaultValue={d.gender ?? ""}
              disabled={pending}
              onChange={(e) =>
                run(() => setMemberGenderAction({ memberId: d.id, gender: e.target.value }))
              }
            >
              <option value="">{t("genderUnset")}</option>
              <option value="female">{t("female")}</option>
              <option value="male">{t("male")}</option>
            </Select>
          </li>
        ))}
      </ul>
      <FormError message={error} />
    </div>
  );
}

/** The public booking link, with copy and a QR code to download (e.g. for a poster at reception). */
export function BookingLink({ url, qrPng }: { url: string; qrPng: string }) {
  const t = useTranslations("settings");
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={qrPng}
        alt={t("qrAlt")}
        width={160}
        height={160}
        className="bg-card size-40 shrink-0 rounded-md border"
        data-testid="booking-qr"
      />
      <div className="flex min-w-0 flex-col gap-2">
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          dir="ltr"
          className="text-brand-strong font-mono text-sm break-all underline"
          data-testid="booking-link"
        >
          {url}
        </a>
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={async () => {
              await navigator.clipboard?.writeText(url).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
          >
            {copied ? <Check /> : <Copy />}
            {copied ? t("copied") : t("copyLink")}
          </Button>
          <a
            href={qrPng}
            download="booking-qr.png"
            className="border-input bg-card hover:bg-accent inline-flex h-8 items-center gap-2 rounded-md border px-3 text-sm font-medium [&_svg]:size-4"
            data-testid="qr-download"
          >
            <Download />
            {t("downloadQr")}
          </a>
        </div>
        <p className="text-muted-foreground text-sm">{t("bookingLinkHint")}</p>
      </div>
    </div>
  );
}
