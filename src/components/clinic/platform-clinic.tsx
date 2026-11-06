"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, ChevronDown, Circle, Play } from "lucide-react";
import {
  issueStatementAction,
  recordStatementPaymentAction,
  setClinicLimitsAction,
  setClinicPlanAction,
  setClinicStatusAction,
  voidStatementAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ClinicStatus } from "@/lib/tenant/status";
import { PLAN_TIERS, PLANS, type PlanTier } from "@/lib/platform/plans";
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
  /** The clinic's own limits (empty = the plan's default). */
  ownLimits: { aiMonthly: number | null; whatsappMonthly: number | null };
  plan: PlanTier;
  planLimits: { aiMonthly: number | null; whatsappMonthly: number | null };
  priceHalalas: number;
  trialEndsOn: string | null;
  graceDays: number;
  pausedForBilling: boolean;
  statements: {
    id: string;
    number: string;
    periodStart: string;
    totalHalalas: number;
    paidHalalas: number;
    dueOn: string;
    status: "issued" | "paid" | "void";
    overdue: boolean;
  }[];
}

type Tab = "overview" | "billing" | "status";

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
  const [tab, setTab] = useState<Tab>("overview");
  const overdue = clinic.statements.some((x) => x.overdue);
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
              <Badge variant="outline">{t(`plan.${clinic.plan}`)}</Badge>
              {clinic.isDemo && <Badge variant="secondary">{t("demo")}</Badge>}
              {overdue && (
                <Badge variant="destructive" data-testid="overdue-badge">
                  {t("overdue")}
                </Badge>
              )}
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
          <div className="flex flex-col gap-4 border-t pt-4">
            <div className="flex flex-wrap gap-1" role="tablist">
              {(["overview", "billing", "status"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  role="tab"
                  aria-selected={tab === k}
                  onClick={() => setTab(k)}
                  data-testid={`clinic-tab-${k}`}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-sm font-medium transition-colors",
                    tab === k
                      ? "bg-brand-soft text-brand-strong"
                      : "text-muted-foreground hover:bg-muted",
                  )}
                >
                  {t(`tabs.${k}`)}
                </button>
              ))}
            </div>
            {tab === "overview" && (
              <div className="grid gap-6 md:grid-cols-2">
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
              </div>
            )}
            {tab === "billing" && <BillingPanel clinic={clinic} />}
            {tab === "status" && (
              <div className="max-w-xl">
                <StatusControl clinic={clinic} />
              </div>
            )}
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
  const [ai, setAi] = useState(clinic.ownLimits.aiMonthly?.toString() ?? "");
  const [wa, setWa] = useState(clinic.ownLimits.whatsappMonthly?.toString() ?? "");
  const planDefault = (v: number | null) =>
    t("planDefault", { value: v === null ? t("noLimit") : String(v) });
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
              placeholder={planDefault(clinic.planLimits.aiMonthly)}
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
              placeholder={planDefault(clinic.planLimits.whatsappMonthly)}
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

const sar = (halalas: number) => (halalas / 100).toFixed(2);

function BillingPanel({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const plan = useAction();
  const issue = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [v, setV] = useState({
    plan: clinic.plan,
    price: sar(clinic.priceHalalas),
    trial: clinic.trialEndsOn ?? "",
    grace: String(clinic.graceDays),
  });
  const features = PLANS[v.plan].features;

  return (
    <div className="grid gap-6 md:grid-cols-2" data-testid="billing-panel">
      <section className="flex flex-col gap-3">
        <h3 className="text-sm font-semibold">{t("planTitle")}</h3>
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            plan.run(
              () =>
                setClinicPlanAction({
                  tenantId: clinic.id,
                  plan: v.plan,
                  priceSar: Number(v.price) || 0,
                  trialEndsOn: v.trial || null,
                  graceDays: Number(v.grace) || 0,
                }),
              () => setMsg(t("planSaved")),
            );
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`plan-${clinic.id}`}>{t("plan.label")}</Label>
              <Select
                id={`plan-${clinic.id}`}
                value={v.plan}
                onChange={(e) => setV({ ...v, plan: e.target.value as PlanTier })}
              >
                {PLAN_TIERS.map((p) => (
                  <option key={p} value={p}>
                    {t(`plan.${p}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`price-${clinic.id}`}>{t("price")}</Label>
              <Input
                id={`price-${clinic.id}`}
                type="number"
                min={0}
                step="0.01"
                dir="ltr"
                value={v.price}
                onChange={(e) => setV({ ...v, price: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`trial-${clinic.id}`}>{t("trialEnds")}</Label>
              <Input
                id={`trial-${clinic.id}`}
                type="date"
                dir="ltr"
                value={v.trial}
                onChange={(e) => setV({ ...v, trial: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`grace-${clinic.id}`}>{t("graceDays")}</Label>
              <Input
                id={`grace-${clinic.id}`}
                type="number"
                min={0}
                max={90}
                dir="ltr"
                value={v.grace}
                onChange={(e) => setV({ ...v, grace: e.target.value })}
              />
            </div>
          </div>
          <ul className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {(Object.keys(features) as (keyof typeof features)[]).map((f) => (
              <li key={f} className="flex items-center gap-1">
                {features[f] ? (
                  <Check className="size-3.5" aria-hidden />
                ) : (
                  <span aria-hidden>–</span>
                )}
                {t(`feature.${f}`)}
              </li>
            ))}
          </ul>
          <p className="text-muted-foreground text-xs">{t("priceHint")}</p>
          <Button
            type="submit"
            variant="outline"
            size="sm"
            className="self-start"
            loading={plan.pending}
            data-testid="plan-save"
          >
            {t("savePlan")}
          </Button>
          <FormError message={plan.error} />
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold">{t("statementsTitle")}</h3>
          <Button
            size="sm"
            variant="outline"
            loading={issue.pending}
            onClick={() =>
              issue.run(
                () => issueStatementAction({ tenantId: clinic.id }),
                (r) => setMsg(t("issued", { number: r.number })),
              )
            }
            data-testid="statement-issue"
          >
            {t("issue")}
          </Button>
        </div>
        <FormError message={issue.error} />
        {clinic.pausedForBilling && (
          <p className="bg-danger text-danger-foreground rounded-lg p-2 text-xs">
            {t("pausedForBilling")}
          </p>
        )}
        {clinic.statements.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t("noStatements")}</p>
        ) : (
          <ul className="flex flex-col gap-2" data-testid="statements">
            {clinic.statements.map((st) => (
              <Statement key={st.id} clinicId={clinic.id} st={st} />
            ))}
          </ul>
        )}
        <p className="text-muted-foreground text-xs">{t("statementsHint")}</p>
      </section>
      <FormSuccess message={msg} />
    </div>
  );
}

function Statement({
  clinicId,
  st,
}: {
  clinicId: string;
  st: PlatformClinicRow["statements"][number];
}) {
  const t = useTranslations("platformClinic");
  const { run, pending, error } = useAction();
  const [paying, setPaying] = useState(false);
  const remaining = st.totalHalalas - st.paidHalalas;
  const [p, setP] = useState({ amount: sar(remaining), method: "transfer", reference: "" });
  const badge =
    st.status === "paid"
      ? ("default" as const)
      : st.status === "void"
        ? ("secondary" as const)
        : st.overdue
          ? ("destructive" as const)
          : ("gold" as const);

  return (
    <li className="flex flex-col gap-2 rounded-lg border p-3 text-sm" data-testid="statement">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-medium" dir="ltr">
          {st.number}
        </span>
        <Badge variant={badge}>
          {st.overdue ? t("overdue") : t(`statementStatus.${st.status}`)}
        </Badge>
      </div>
      <div className="text-muted-foreground flex flex-wrap gap-x-4 text-xs">
        <span>{t("statementTotal", { amount: sar(st.totalHalalas) })}</span>
        {st.paidHalalas > 0 && <span>{t("statementPaid", { amount: sar(st.paidHalalas) })}</span>}
        <span>{t("statementDue", { day: st.dueOn })}</span>
      </div>
      {st.status === "issued" && !paying && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => setPaying(true)} data-testid="statement-pay">
            {t("recordPayment")}
          </Button>
          {st.paidHalalas === 0 && (
            <Button
              size="sm"
              variant="ghost"
              loading={pending}
              onClick={() =>
                run(() => voidStatementAction({ tenantId: clinicId, statementId: st.id }))
              }
            >
              {t("void")}
            </Button>
          )}
        </div>
      )}
      {paying && (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () =>
                recordStatementPaymentAction({
                  tenantId: clinicId,
                  statementId: st.id,
                  amountSar: Number(p.amount) || 0,
                  method: p.method,
                  reference: p.reference || null,
                }),
              () => setPaying(false),
            );
          }}
        >
          <div className="grid grid-cols-2 gap-2">
            <Input
              type="number"
              step="0.01"
              min={0.01}
              dir="ltr"
              aria-label={t("amount")}
              value={p.amount}
              onChange={(e) => setP({ ...p, amount: e.target.value })}
            />
            <Select
              aria-label={t("method")}
              value={p.method}
              onChange={(e) => setP({ ...p, method: e.target.value })}
            >
              {(["transfer", "card", "cash"] as const).map((m) => (
                <option key={m} value={m}>
                  {t(`methods.${m}`)}
                </option>
              ))}
            </Select>
          </div>
          <Input
            placeholder={t("reference")}
            aria-label={t("reference")}
            value={p.reference}
            onChange={(e) => setP({ ...p, reference: e.target.value })}
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" loading={pending} data-testid="statement-pay-save">
              {t("savePayment")}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setPaying(false)}>
              {t("cancel")}
            </Button>
          </div>
        </form>
      )}
      <FormError message={error} />
    </li>
  );
}
