"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, ChevronDown, Circle, Play } from "lucide-react";
import { setClinicLimitsAction, setClinicStatusAction } from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ClinicStatus } from "@/lib/tenant/status";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export interface PlatformClinicRow {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  isDemo: boolean;
  status: ClinicStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  setup: { step: string; done: boolean }[];
  usage: {
    staff: number;
    doctors: number;
    branches: number;
    appointmentsThisMonth: number;
    whatsappThisMonth: number;
    aiRepliesThisMonth: number;
    aiScribeThisMonth: number;
    files: number;
    lastSignInAt: string | null;
    limits: { aiMonthly: number | null; whatsappMonthly: number | null };
  };
}

const WARN_AT = 0.8;
const pct = (used: number, limit: number | null) =>
  limit === null ? null : limit === 0 ? 100 : Math.round((used / limit) * 100);

const STATUS_BADGE: Record<ClinicStatus, "default" | "secondary" | "destructive" | "gold"> = {
  active: "default",
  read_only: "gold",
  suspended: "destructive",
  closed: "secondary",
};

/** One clinic on the platform page: status, setup progress, and the owner's controls. */
export function PlatformClinic({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const [open, setOpen] = useState(false);
  const done = clinic.setup.filter((s) => s.done).length;
  const total = clinic.setup.length;
  const u = clinic.usage;
  const aiPct = pct(u.aiRepliesThisMonth + u.aiScribeThisMonth, u.limits.aiMonthly);
  const waPct = pct(u.whatsappThisMonth, u.limits.whatsappMonthly);

  return (
    <Card data-testid="platform-clinic" data-slug={clinic.slug}>
      <CardContent className="flex flex-col gap-4 pt-5">
        <button
          type="button"
          className="flex items-center gap-3 text-start"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span
            className="size-9 shrink-0 rounded-full"
            style={{ background: clinic.brandColor }}
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              {clinic.name}
              <Badge variant={STATUS_BADGE[clinic.status]} data-testid="clinic-status">
                {t(`status.${clinic.status}`)}
              </Badge>
              {clinic.isDemo && <Badge variant="secondary">{t("demo")}</Badge>}
              {aiPct !== null && aiPct >= WARN_AT * 100 && (
                <Badge variant={aiPct >= 100 ? "destructive" : "gold"} data-testid="limit-badge">
                  {t("aiPct", { pct: aiPct })}
                </Badge>
              )}
              {waPct !== null && waPct >= WARN_AT * 100 && (
                <Badge variant={waPct >= 100 ? "destructive" : "gold"} data-testid="limit-badge">
                  {t("waPct", { pct: waPct })}
                </Badge>
              )}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span dir="ltr">{clinic.slug}</span>
              <span>{t("setupProgress", { done, total })}</span>
            </div>
            <div className="bg-muted h-1.5 w-full max-w-xs overflow-hidden rounded-full">
              <div
                className="bg-brand h-full rounded-full"
                style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }}
              />
            </div>
          </div>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {open && (
          <div className="grid gap-6 border-t pt-4 md:grid-cols-2 xl:grid-cols-3">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("setupTitle")}</h3>
              <ul className="flex flex-col gap-1.5" data-testid="setup-checklist">
                {clinic.setup.map((s) => (
                  <li key={s.step} className="flex items-center gap-2 text-sm">
                    {s.done ? (
                      <Check className="text-success-foreground size-4" aria-hidden />
                    ) : (
                      <Circle className="text-muted-foreground size-4" aria-hidden />
                    )}
                    <span className={s.done ? "" : "text-muted-foreground"}>
                      {t(`setup.${s.step}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <UsagePanel clinic={clinic} />
            <StatusControl clinic={clinic} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusControl({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const { run, pending, error } = useAction();
  const choices = (["read_only", "suspended", "closed"] as const).filter(
    (s) => s !== clinic.status,
  );
  const [picked, setStatus] = useState<ClinicStatus>(choices[0]);
  // After a change the list of choices changes too; never show a choice that isn't offered.
  const status = choices.includes(picked as (typeof choices)[number]) ? picked : choices[0];
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const apply = (to: ClinicStatus, why: string) =>
    run(
      () => setClinicStatusAction({ tenantId: clinic.id, status: to, reason: why || null }),
      () => {
        setMsg(t("changed", { status: t(`status.${to}`) }));
        setReason("");
      },
    );

  return (
    <section className="flex flex-col gap-3" data-testid="status-control">
      <h3 className="text-sm font-semibold">{t("statusTitle")}</h3>
      {clinic.status !== "active" && (
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
          <span>
            {t(`explain.${clinic.status}`)}
            {clinic.statusReason ? ` · ${clinic.statusReason}` : ""}
          </span>
          <Button
            size="sm"
            className="self-start"
            loading={pending}
            onClick={() => apply("active", "")}
            data-testid="clinic-resume"
          >
            <Play />
            {t("resume")}
          </Button>
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(status, reason);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`st-${clinic.id}`}>{t("changeTo")}</Label>
          <Select
            id={`st-${clinic.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ClinicStatus)}
          >
            {choices.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">{t(`explain.${status}`)}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`why-${clinic.id}`}>{t("reason")}</Label>
          <Input
            id={`why-${clinic.id}`}
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonHint")}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="self-start"
          loading={pending}
          data-testid="clinic-status-apply"
        >
          {t("apply")}
        </Button>
      </form>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </section>
  );
}

function UsagePanel({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const format = useFormatter();
  const u = clinic.usage;
  const { run, pending, error } = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [ai, setAi] = useState(u.limits.aiMonthly?.toString() ?? "");
  const [wa, setWa] = useState(u.limits.whatsappMonthly?.toString() ?? "");
  const num = (v: string) => (v.trim() === "" ? null : Math.max(0, Math.floor(Number(v))));
  const aiUsed = u.aiRepliesThisMonth + u.aiScribeThisMonth;

  return (
    <section className="flex flex-col gap-3" data-testid="usage-panel">
      <h3 className="text-sm font-semibold">{t("usageTitle")}</h3>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-sm">
        {(
          [
            ["staff", u.staff],
            ["doctors", u.doctors],
            ["branches", u.branches],
            ["appointments", u.appointmentsThisMonth],
            ["files", u.files],
          ] as const
        ).map(([k, n]) => (
          <div key={k} className="contents">
            <dt className="text-muted-foreground">{t(`usage.${k}`)}</dt>
            <dd className="font-medium tabular-nums">{n}</dd>
          </div>
        ))}
        <dt className="text-muted-foreground">{t("usage.lastSignIn")}</dt>
        <dd className="font-medium">
          {u.lastSignInAt
            ? format.relativeTime(new Date(u.lastSignInAt), new Date())
            : t("usage.never")}
        </dd>
      </dl>
      <Meter
        label={t("usage.ai", { replies: u.aiRepliesThisMonth, scribe: u.aiScribeThisMonth })}
        used={aiUsed}
        limit={u.limits.aiMonthly}
      />
      <Meter
        label={t("usage.whatsapp")}
        used={u.whatsappThisMonth}
        limit={u.limits.whatsappMonthly}
      />
      <form
        className="flex flex-col gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          run(
            () =>
              setClinicLimitsAction({
                tenantId: clinic.id,
                aiMonthly: num(ai),
                whatsappMonthly: num(wa),
              }),
            () => setMsg(t("limitsSaved")),
          );
        }}
      >
        <div className="grid grid-cols-2 gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor={`ai-${clinic.id}`}>{t("aiLimit")}</Label>
            <Input
              id={`ai-${clinic.id}`}
              type="number"
              min={0}
              dir="ltr"
              value={ai}
              placeholder={t("noLimit")}
              onChange={(e) => setAi(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <Label htmlFor={`wa-${clinic.id}`}>{t("waLimit")}</Label>
            <Input
              id={`wa-${clinic.id}`}
              type="number"
              min={0}
              dir="ltr"
              value={wa}
              placeholder={t("noLimit")}
              onChange={(e) => setWa(e.target.value)}
            />
          </div>
        </div>
        <p className="text-muted-foreground text-xs">{t("limitsHint")}</p>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="self-start"
          loading={pending}
          data-testid="limits-save"
        >
          {t("saveLimits")}
        </Button>
        <FormError message={error} />
        <FormSuccess message={msg} />
      </form>
    </section>
  );
}

function Meter({ label, used, limit }: { label: string; used: number; limit: number | null }) {
  const t = useTranslations("platformClinic");
  const p = pct(used, limit);
  return (
    <div className="flex flex-col gap-1 text-sm">
      <div className="flex justify-between gap-2">
        <span>{label}</span>
        <span className="text-muted-foreground tabular-nums" dir="ltr">
          {limit === null ? `${used}` : `${used} / ${limit}`}
        </span>
      </div>
      {p !== null ? (
        <div className="bg-muted h-1.5 overflow-hidden rounded-full">
          <div
            className={cn(
              "h-full rounded-full",
              p >= 100
                ? "bg-danger-foreground"
                : p >= WARN_AT * 100
                  ? "bg-gold-foreground"
                  : "bg-brand",
            )}
            style={{ width: `${Math.min(p, 100)}%` }}
          />
        </div>
      ) : (
        <span className="text-muted-foreground text-xs">{t("noLimitSet")}</span>
      )}
    </div>
  );
}
