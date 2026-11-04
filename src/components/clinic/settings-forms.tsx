"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import {
  refreshDemoAction,
  saveConsentRuleAction,
  saveTemplateAction,
  updateSettingsAction,
} from "@/app/actions/clinic";
import { Select } from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export function ScheduleSettingForm({ initial }: { initial: boolean }) {
  const t = useTranslations("settings");
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="accent-brand size-5"
          checked={on}
          disabled={pending}
          data-testid="doctors-manage-toggle"
          onChange={(e) => {
            const value = e.target.checked;
            setOn(value);
            run(
              () => updateSettingsAction({ doctorsManageOwnSchedule: value }),
              () => setMsg(t("savedOk")),
            );
          }}
        />
        <span className="font-medium">
          {t("doctorsManage")} — {on ? t("on") : t("off")}
        </span>
      </label>
      <p className="text-muted-foreground text-sm">{t("doctorsManageHint")}</p>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

/** May doctors change their own working hours? (Admins and reception always can.) */
export function HoursSettingForm({ initial }: { initial: boolean }) {
  const t = useTranslations("settings");
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="accent-brand size-5"
          checked={on}
          disabled={pending}
          data-testid="doctors-hours-toggle"
          onChange={(e) => {
            const value = e.target.checked;
            setOn(value);
            run(
              () => updateSettingsAction({ doctorsEditOwnHours: value }),
              () => setMsg(t("savedOk")),
            );
          }}
        />
        <span className="font-medium">
          {t("doctorsEditHours")} — {on ? t("on") : t("off")}
        </span>
      </label>
      <p className="text-muted-foreground text-sm">{t("doctorsEditHoursHint")}</p>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

/** AI scribe for doctors: on/off (clinic admin). */
export function ScribeSettingForm({ initial, keySet }: { initial: boolean; keySet: boolean }) {
  const t = useTranslations("scribe");
  const ts = useTranslations("settings");
  const tw = useTranslations("whatsapp.ai");
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2" data-testid="scribe-settings">
      <label className="flex items-center gap-3">
        <input
          type="checkbox"
          className="accent-brand size-5"
          checked={on}
          disabled={pending}
          data-testid="scribe-toggle"
          onChange={(e) => {
            const value = e.target.checked;
            setOn(value);
            run(
              () => updateSettingsAction({ aiScribeEnabled: value }),
              () => setMsg(ts("savedOk")),
            );
          }}
        />
        <span className="font-medium">
          {t("settingTitle")} — {on ? t("on") : t("off")}
        </span>
      </label>
      <p className="text-muted-foreground text-sm">{t("settingHint")}</p>
      <p className={keySet ? "text-success-foreground text-sm" : "text-warning-foreground text-sm"}>
        {keySet ? tw("keySet") : tw("keyMissing")}
      </p>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

export function RefreshDemoButton() {
  const t = useTranslations("settings");
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <p className="text-muted-foreground text-sm">{t("refreshDemoHint")}</p>
      <Button
        variant="outline"
        className="self-start"
        disabled={pending}
        onClick={() =>
          run(
            () => refreshDemoAction(),
            (r) => setMsg(t("refreshedOk", { moved: r.moved, cancelled: r.cancelled })),
          )
        }
      >
        <RefreshCw />
        {t("refreshDemo")}
      </Button>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

export function TemplateEditor({
  code,
  initial,
}: {
  code: string;
  initial: { titleAr: string; titleEn: string; bodyAr: string; bodyEn: string };
}) {
  const t = useTranslations("settings");
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const set =
    (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setV({ ...v, [k]: e.target.value });
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <Label htmlFor="titleAr">{t("titleAr")}</Label>
          <Input id="titleAr" value={v.titleAr} onChange={set("titleAr")} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="titleEn">{t("titleEn")}</Label>
          <Input id="titleEn" dir="ltr" value={v.titleEn} onChange={set("titleEn")} />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bodyAr">{t("bodyAr")}</Label>
          <Textarea
            id="bodyAr"
            className="min-h-72 leading-7"
            value={v.bodyAr}
            onChange={set("bodyAr")}
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="bodyEn">{t("bodyEn")}</Label>
          <Textarea
            id="bodyEn"
            dir="ltr"
            className="min-h-72 leading-7"
            value={v.bodyEn}
            onChange={set("bodyEn")}
          />
        </div>
      </div>
      <p className="text-muted-foreground text-sm">{t("versionHint")}</p>
      <FormError message={error} />
      <FormSuccess message={msg} />
      <Button
        className="self-end"
        disabled={pending}
        onClick={() =>
          run(
            () => saveTemplateAction({ code, ...v }),
            (r) => setMsg(`${t("versionSaved")} (v${r.version})`),
          )
        }
      >
        {t("saveVersion")}
      </Button>
    </div>
  );
}

const RULES = ["every_visit", "per_package", "months", "template_change"] as const;

/** Admin: when does this consent need a NEW signature? */
export function ConsentRuleEditor({
  code,
  initial,
}: {
  code: string;
  initial: { rule: (typeof RULES)[number]; months: number | null };
}) {
  const t = useTranslations("consentRules");
  const [rule, setRule] = useState(initial.rule);
  const [months, setMonths] = useState(String(initial.months ?? 12));
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-3" data-testid="consent-rule">
      <div className="flex flex-col gap-1">
        <Label htmlFor="consent-rule">{t("label")}</Label>
        <Select
          id="consent-rule"
          value={rule}
          onChange={(e) => setRule(e.target.value as (typeof RULES)[number])}
        >
          {RULES.map((r) => (
            <option key={r} value={r}>
              {t(`rules.${r}`)}
            </option>
          ))}
        </Select>
        <p className="text-muted-foreground text-sm">{t(`hints.${rule}`)}</p>
      </div>
      {rule === "months" && (
        <div className="flex flex-col gap-1">
          <Label htmlFor="consent-months">{t("months")}</Label>
          <Input
            id="consent-months"
            type="number"
            min={1}
            max={120}
            inputMode="numeric"
            className="w-28"
            value={months}
            onChange={(e) => setMonths(e.target.value)}
          />
        </div>
      )}
      <p className="text-muted-foreground text-xs">{t("alwaysNewText")}</p>
      <FormError message={error} />
      <FormSuccess message={msg} />
      <Button
        className="self-end"
        disabled={pending}
        onClick={() =>
          run(
            () =>
              saveConsentRuleAction({
                code,
                rule,
                months: rule === "months" ? Number(months) : null,
              }),
            () => setMsg(t("saved")),
          )
        }
      >
        {t("save")}
      </Button>
    </div>
  );
}
