"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Crown, RefreshCw } from "lucide-react";
import {
  cancelMembershipAction,
  membershipPaymentAction,
  renewMembershipAction,
  sellMembershipAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import type { Locale } from "@/i18n/config";
import { formatGregorian, formatSAR } from "@/lib/format";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export interface MembershipPeriodView {
  id: string;
  nameAr: string;
  nameEn: string;
  priceHalalas: number;
  periodMonths: number;
  includedVisits: number;
  serviceAr: string | null;
  serviceEn: string | null;
  discountPercent: number;
  startsOn: string;
  endsOn: string;
  cancelled: boolean;
  renewed: boolean;
  paidHalalas: number;
  outstandingHalalas: number;
  visitsUsed: number;
  /** running | upcoming | ended | cancelled (worked out on the server for today). */
  state: "running" | "upcoming" | "ended" | "cancelled";
}
export interface MembershipPlanOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceHalalas: number;
  periodMonths: number;
}

const day = (d: string) => new Date(`${d}T12:00:00+03:00`);

/**
 * The patient's membership: the running period (included visits used, discount, what is still
 * owed) with Renew / Record payment / Cancel, the history, and "Sell a membership" when none runs.
 */
export function MembershipPanel({
  patientId,
  periods,
  plans,
  canSell,
}: {
  patientId: string;
  periods: MembershipPeriodView[];
  plans: MembershipPlanOption[];
  canSell: boolean;
}) {
  const t = useTranslations("memberships");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string }) => (locale === "en" ? o.nameEn : o.nameAr);
  const date = (d: string) => formatGregorian(day(d), locale, "medium");
  const current =
    periods.find((p) => p.state === "running") ?? periods.find((p) => p.state === "upcoming");
  const history = periods.filter((p) => p !== current);
  const hasRunning = periods.some((p) => p.state === "running" || p.state === "upcoming");

  return (
    <Card data-testid="membership-panel">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Crown className="text-gold-foreground size-4" />
          {t("title")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {current ? (
          <PeriodCard
            patientId={patientId}
            p={current}
            canSell={canSell}
            name={name(current)}
            date={date}
          />
        ) : (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        )}
        {/* A lapsed, not-renewed period can be renewed from the history. */}
        {!hasRunning &&
          history
            .filter((p) => p.state === "ended" && !p.renewed)
            .slice(0, 1)
            .map((p) => (
              <RenewRow key={p.id} p={p} canSell={canSell} lapsed />
            ))}
        {canSell && !hasRunning && plans.length > 0 && (
          <SellMembership patientId={patientId} plans={plans} />
        )}
        {history.length > 0 && (
          <details className="text-sm">
            <summary className="text-muted-foreground cursor-pointer">
              {t("history", { n: history.length })}
            </summary>
            <ul className="mt-2 flex flex-col divide-y rounded-lg border">
              {history.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs">
                  <span className="font-medium">{name(p)}</span>
                  <span className="text-muted-foreground">
                    {date(p.startsOn)} – {date(p.endsOn)}
                  </span>
                  <Badge variant="secondary">{t(`state.${p.state}`)}</Badge>
                  <span className="ms-auto tabular-nums" dir="ltr">
                    {formatSAR(p.paidHalalas, locale)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
      </CardContent>
    </Card>
  );
}

function PeriodCard({
  patientId,
  p,
  canSell,
  name,
  date,
}: {
  patientId: string;
  p: MembershipPeriodView;
  canSell: boolean;
  name: string;
  date: (d: string) => string;
}) {
  const t = useTranslations("memberships");
  const locale = useLocale() as Locale;
  const cancel = useAction();
  const [confirming, setConfirming] = useState(false);
  const service = locale === "en" ? p.serviceEn : p.serviceAr;
  return (
    <div
      className="bg-card flex flex-col gap-2 rounded-lg border p-3"
      data-testid="membership-current"
      data-state={p.state}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{name}</span>
        <Badge variant="gold">{t(`state.${p.state}`)}</Badge>
        <span className="text-muted-foreground ms-auto text-xs">
          {t("dates", { from: date(p.startsOn), to: date(p.endsOn) })}
        </span>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-1 text-sm">
        {p.includedVisits > 0 && (
          <span data-testid="membership-visits">
            {t("visitsLeft", {
              left: Math.max(0, p.includedVisits - p.visitsUsed),
              total: p.includedVisits,
              service: service ?? "",
            })}
          </span>
        )}
        {p.discountPercent > 0 && (
          <span>{t("discount", { percent: p.discountPercent })}</span>
        )}
        <span className="text-muted-foreground">
          {t("price", { price: formatSAR(p.priceHalalas, locale), months: p.periodMonths })}
        </span>
        {p.outstandingHalalas > 0 && (
          <span className="text-warning-foreground font-medium" data-testid="membership-owed">
            {t("owed", { amount: formatSAR(p.outstandingHalalas, locale) })}
          </span>
        )}
      </div>
      {canSell && p.outstandingHalalas > 0 && (
        <PaymentRow patientId={patientId} membershipId={p.id} max={p.outstandingHalalas} />
      )}
      {canSell && !p.renewed && <RenewRow p={p} canSell={canSell} />}
      {canSell && (
        <div className="flex flex-wrap items-center gap-2">
          {confirming ? (
            <>
              <span className="text-sm">{t("cancelConfirm")}</span>
              <Button
                size="sm"
                variant="outline"
                loading={cancel.pending}
                data-testid="membership-cancel-yes"
                onClick={() => cancel.run(() => cancelMembershipAction({ membershipId: p.id }))}
              >
                {t("cancelYes")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirming(false)}>
                {t("keep")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setConfirming(true)}
            >
              {t("cancel")}
            </Button>
          )}
          <FormError message={cancel.error} />
        </div>
      )}
    </div>
  );
}

function PayFields({
  idPrefix,
  pay,
  setPay,
  method,
  setMethod,
  invoice,
  setInvoice,
}: {
  idPrefix: string;
  pay: string;
  setPay: (v: string) => void;
  method: "cash" | "card" | "transfer";
  setMethod: (v: "cash" | "card" | "transfer") => void;
  invoice: string;
  setInvoice: (v: string) => void;
}) {
  const t = useTranslations("memberships");
  return (
    <>
      <div className="flex w-32 flex-col gap-1">
        <Label htmlFor={`${idPrefix}-pay`}>{t("payNow")}</Label>
        <Input
          id={`${idPrefix}-pay`}
          type="number"
          min={0}
          inputMode="decimal"
          value={pay}
          onChange={(e) => setPay(e.target.value)}
          dir="ltr"
          data-testid={`${idPrefix}-pay`}
        />
      </div>
      <div className="flex w-32 flex-col gap-1">
        <Label htmlFor={`${idPrefix}-method`}>{t("method")}</Label>
        <Select
          id={`${idPrefix}-method`}
          value={method}
          onChange={(e) => setMethod(e.target.value as "cash" | "card" | "transfer")}
        >
          {(["card", "cash", "transfer"] as const).map((m) => (
            <option key={m} value={m}>
              {t(`methods.${m}`)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex w-36 flex-col gap-1">
        <Label htmlFor={`${idPrefix}-inv`}>{t("invoice")}</Label>
        <Input
          id={`${idPrefix}-inv`}
          value={invoice}
          onChange={(e) => setInvoice(e.target.value)}
          maxLength={60}
          dir="ltr"
        />
      </div>
    </>
  );
}

function usePay() {
  const [pay, setPay] = useState("");
  const [method, setMethod] = useState<"cash" | "card" | "transfer">("card");
  const [invoice, setInvoice] = useState("");
  const payment = () =>
    Number(pay) > 0 ? { paySar: Number(pay), method, invoiceNumber: invoice || null } : null;
  const reset = () => {
    setPay("");
    setInvoice("");
  };
  return { pay, setPay, method, setMethod, invoice, setInvoice, payment, reset };
}

function SellMembership({ patientId, plans }: { patientId: string; plans: MembershipPlanOption[] }) {
  const t = useTranslations("memberships");
  const locale = useLocale() as Locale;
  const act = useAction();
  const p = usePay();
  const [planId, setPlanId] = useState(plans[0]?.id ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2 rounded-lg border p-3" data-testid="membership-sell">
      <span className="text-sm font-medium">{t("sell")}</span>
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex min-w-56 flex-1 flex-col gap-1">
          <Label htmlFor="mem-plan">{t("plan")}</Label>
          <Select id="mem-plan" value={planId} onChange={(e) => setPlanId(e.target.value)}>
            {plans.map((x) => (
              <option key={x.id} value={x.id}>
                {locale === "en" ? x.nameEn : x.nameAr} —{" "}
                {t("price", { price: formatSAR(x.priceHalalas, locale), months: x.periodMonths })}
              </option>
            ))}
          </Select>
        </div>
        <PayFields idPrefix="mem-sell" {...p} />
        <Button
          loading={act.pending}
          disabled={!planId}
          data-testid="membership-sell-submit"
          onClick={() =>
            act.run(
              () => sellMembershipAction({ patientId, planId, payment: p.payment() }),
              () => {
                setMsg(t("soldOk"));
                p.reset();
              },
            )
          }
        >
          {t("sell")}
        </Button>
      </div>
      <FormError message={act.error} />
      <FormSuccess message={msg} />
    </div>
  );
}

function RenewRow({
  p,
  canSell,
  lapsed,
}: {
  p: MembershipPeriodView;
  canSell: boolean;
  lapsed?: boolean;
}) {
  const t = useTranslations("memberships");
  const act = useAction();
  const pay = usePay();
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  if (!canSell) return null;
  return (
    <div className="flex flex-col gap-2">
      {lapsed && <p className="text-muted-foreground text-sm">{t("lapsed")}</p>}
      {open ? (
        <div className="flex flex-wrap items-end gap-2" data-testid="membership-renew">
          <PayFields idPrefix="mem-renew" {...pay} />
          <Button
            loading={act.pending}
            data-testid="membership-renew-submit"
            onClick={() =>
              act.run(
                () => renewMembershipAction({ membershipId: p.id, payment: pay.payment() }),
                () => {
                  setOpen(false);
                  setMsg(t("renewedOk"));
                },
              )
            }
          >
            {t("renew")}
          </Button>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t("keep")}
          </Button>
        </div>
      ) : (
        <Button
          size="sm"
          variant="outline"
          className="self-start"
          onClick={() => setOpen(true)}
          data-testid="membership-renew-open"
        >
          <RefreshCw />
          {t("renew")}
        </Button>
      )}
      <FormError message={act.error} />
      <FormSuccess message={msg} />
    </div>
  );
}

function PaymentRow({
  patientId,
  membershipId,
  max,
}: {
  patientId: string;
  membershipId: string;
  max: number;
}) {
  const t = useTranslations("memberships");
  const act = useAction();
  const p = usePay();
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <PayFields idPrefix="mem-pay" {...p} />
        <Button
          variant="outline"
          loading={act.pending}
          disabled={!(Number(p.pay) > 0) || Number(p.pay) * 100 > max}
          data-testid="membership-pay-submit"
          onClick={() =>
            act.run(
              () =>
                membershipPaymentAction({
                  membershipId,
                  patientId,
                  paySar: Number(p.pay),
                  method: p.method,
                  invoiceNumber: p.invoice || null,
                }),
              () => {
                setMsg(t("paidOk"));
                p.reset();
              },
            )
          }
        >
          {t("recordPayment")}
        </Button>
      </div>
      <FormError message={act.error} />
      <FormSuccess message={msg} />
    </div>
  );
}
