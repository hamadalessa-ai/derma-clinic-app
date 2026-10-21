"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { RefreshCw } from "lucide-react";
import { refreshDemoAction, saveTemplateAction, updateSettingsAction } from "@/app/actions/clinic";
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
