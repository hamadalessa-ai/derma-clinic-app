"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  sendTestWhatsappAction,
  updateServiceTextsAction,
  updateSettingsAction,
  updateTemplateAction,
} from "@/app/actions/clinic";
import { FormError, FormSuccess } from "@/components/clinic/form-message";
import { useAction } from "@/components/clinic/use-action";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

export function ShowServiceToggle({ initial }: { initial: boolean }) {
  const t = useTranslations("whatsapp");
  const [on, setOn] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-1">
      <label className="flex items-start gap-3">
        <input
          type="checkbox"
          className="accent-brand mt-0.5 size-5 shrink-0"
          checked={on}
          disabled={pending}
          data-testid="show-service"
          onChange={(e) => {
            const value = e.target.checked;
            setOn(value);
            run(
              () => updateSettingsAction({ showServiceInMessages: value }),
              () => setMsg(t("saved")),
            );
          }}
        />
        <span className="flex flex-col gap-0.5">
          <span className="font-medium">{t("showService")}</span>
          <span className="text-muted-foreground text-sm">{t("showServiceHint")}</span>
        </span>
      </label>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </div>
  );
}

export function TemplateEditor({
  kind,
  label,
  canDisable,
  variables,
  initial,
}: {
  kind: string;
  label: string;
  canDisable: boolean;
  variables: string[];
  initial: { enabled: boolean; bodyAr: string; bodyEn: string };
}) {
  const t = useTranslations("whatsapp");
  const [v, setV] = useState(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <details className="rounded-md border" data-testid="template" data-kind={kind}>
      <summary className="flex cursor-pointer items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
        <span>{label}</span>
        <span
          className={
            v.enabled ? "text-success-foreground text-xs" : "text-muted-foreground text-xs"
          }
        >
          {v.enabled ? t("enabled") : "—"}
        </span>
      </summary>
      <form
        className="flex flex-col gap-3 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          run(
            () => updateTemplateAction({ kind, ...v }),
            () => setMsg(t("saved")),
          );
        }}
      >
        {canDisable && (
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={v.enabled}
              onChange={(e) => setV({ ...v, enabled: e.target.checked })}
            />
            {t("enabled")}
          </label>
        )}
        <p className="text-muted-foreground text-xs">
          {t("placeholders")}{" "}
          <span dir="ltr" className="font-mono">
            {variables.map((x) => `{${x}}`).join(" ")}
          </span>
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${kind}-ar`}>{t("textAr")}</Label>
            <Textarea
              id={`${kind}-ar`}
              rows={5}
              value={v.bodyAr}
              onChange={(e) => setV({ ...v, bodyAr: e.target.value })}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`${kind}-en`}>{t("textEn")}</Label>
            <Textarea
              id={`${kind}-en`}
              dir="ltr"
              rows={5}
              value={v.bodyEn}
              onChange={(e) => setV({ ...v, bodyEn: e.target.value })}
            />
          </div>
        </div>
        <FormError message={error} />
        <FormSuccess message={msg} />
        <Button type="submit" size="sm" className="self-start" disabled={pending}>
          {t("save")}
        </Button>
      </form>
    </details>
  );
}

export function ServiceTextsEditor({
  service,
}: {
  service: {
    id: string;
    nameAr: string;
    nameEn: string;
    preVisitAr: string;
    preVisitEn: string;
    postCareAr: string;
    postCareEn: string;
    recallAfterDays: number | null;
  };
}) {
  const t = useTranslations("whatsapp");
  const locale = useLocale();
  const [v, setV] = useState(service);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const field = (k: "preVisitAr" | "preVisitEn" | "postCareAr" | "postCareEn", ltr = false) => (
    <Textarea
      rows={2}
      dir={ltr ? "ltr" : undefined}
      aria-label={k}
      value={v[k]}
      onChange={(e) => setV({ ...v, [k]: e.target.value })}
    />
  );
  return (
    <details className="rounded-md border" data-testid="service-texts">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium">
        {locale === "en" ? service.nameEn : service.nameAr}
        {service.recallAfterDays ? (
          <span className="text-muted-foreground">
            {" "}
            · {t("recallDays")}: {service.recallAfterDays}
          </span>
        ) : null}
      </summary>
      <form
        className="flex flex-col gap-3 border-t p-3"
        onSubmit={(e) => {
          e.preventDefault();
          setMsg(null);
          run(
            () => updateServiceTextsAction({ ...v, serviceId: v.id }),
            () => setMsg(t("saved")),
          );
        }}
      >
        <div className="flex flex-col gap-1">
          <Label>{t("preVisit")}</Label>
          <div className="grid gap-2 md:grid-cols-2">
            {field("preVisitAr")}
            {field("preVisitEn", true)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label>{t("postCare")}</Label>
          <div className="grid gap-2 md:grid-cols-2">
            {field("postCareAr")}
            {field("postCareEn", true)}
          </div>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`recall-${service.id}`}>{t("recallDays")}</Label>
          <Input
            id={`recall-${service.id}`}
            type="number"
            min={1}
            max={730}
            className="w-32"
            value={v.recallAfterDays ?? ""}
            onChange={(e) =>
              setV({ ...v, recallAfterDays: e.target.value ? Number(e.target.value) : null })
            }
          />
        </div>
        <FormError message={error} />
        <FormSuccess message={msg} />
        <Button type="submit" size="sm" className="self-start" disabled={pending}>
          {t("save")}
        </Button>
      </form>
    </details>
  );
}

export function SendTestMessage({ live }: { live: boolean }) {
  const t = useTranslations("whatsapp");
  const [phone, setPhone] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  if (!live) return <p className="text-muted-foreground text-sm">{t("testOnlyLive")}</p>;
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        setFail(null);
        run(
          () => sendTestWhatsappAction({ phone }),
          (r) =>
            r.ok ? setMsg(t("testOk")) : setFail(t("testFailed", { error: r.errorCode ?? "" })),
        );
      }}
    >
      <p className="text-muted-foreground text-sm">{t("testHint")}</p>
      <div className="flex gap-2">
        <Input
          dir="ltr"
          inputMode="tel"
          placeholder="05XXXXXXXX"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
          required
        />
        <Button type="submit" disabled={pending}>
          {t("testSend")}
        </Button>
      </div>
      <FormError message={error ?? fail} />
      <FormSuccess message={msg} />
    </form>
  );
}
