"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, Pill, Plus, Receipt, Repeat, Sparkles, X } from "lucide-react";
import {
  addVisitChargeAction,
  addVisitOrderAction,
  postVisitAction,
  removeVisitChargeAction,
  removeVisitOrderAction,
  saveDraftAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { AiScribe } from "./ai-scribe";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export interface ChargeView {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string;
  quantity: number;
  unitPriceHalalas: number;
  coveredByPackage: boolean;
}
export interface OrderView {
  id: string;
  kind: "medication" | "treatment";
  name: string;
  dose: string | null;
  frequency: string | null;
  duration: string | null;
  sessions: number | null;
  intervalWeeks: number | null;
  serviceId: string | null;
  instructions: string | null;
}
export interface Catalog {
  services: { id: string; code: string; nameAr: string; nameEn: string; priceHalalas: number }[];
  items: {
    id: string;
    code: string;
    nameAr: string;
    nameEn: string;
    priceHalalas: number;
    unitAr: string | null;
    unitEn: string | null;
  }[];
}

const sar = (h: number) => (h / 100).toFixed(2);

function useL() {
  const ar = useLocale() === "ar";
  return (a: string | null | undefined, e: string | null | undefined) =>
    (ar ? a || e : e || a) ?? "";
}

/**
 * The visit screen's work area: the note (with the AI scribe), the doctor's orders, the invoice
 * codes and ONE "Post visit" — the doctor's or, in the doctor's name, her nurse / assistant's.
 */
export function VisitWorkspace({
  appointmentId,
  patientId,
  note,
  scribe,
  preparingFor,
  charges,
  orders,
  catalog,
}: {
  appointmentId: string;
  patientId: string;
  note: {
    id: string;
    body: string;
    aiDrafted: boolean;
    authorName: string;
    enteredByName: string | null;
  };
  scribe: boolean;
  preparingFor: string | null;
  charges: ChargeView[];
  orders: OrderView[];
  catalog: Catalog;
}) {
  const t = useTranslations("visit");
  const tn = useTranslations("notes");
  const ts = useTranslations("scribe");
  const router = useRouter();
  const [body, setBody] = useState(note.body);
  const [msg, setMsg] = useState<string | null>(null);
  const save = useAction();
  const post = useAction();

  return (
    <div className="flex flex-col gap-5" data-testid="visit-workspace">
      <Card data-testid="note-card" data-status="draft">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base">{t("noteFor", { name: note.authorName })}</CardTitle>
          {note.aiDrafted && (
            <Badge variant="outline" data-testid="ai-draft-badge">
              <Sparkles className="size-3" />
              {ts("aiDraft")}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          {scribe && <AiScribe patientId={patientId} noteId={note.id} onDrafted={setBody} />}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={tn("placeholder")}
            className="min-h-40"
            aria-label={t("note")}
            data-testid="visit-note"
          />
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {note.enteredByName ? tn("enteredBy", { name: note.enteredByName }) : ""}
            </span>
            <Button
              variant="outline"
              size="sm"
              loading={save.pending}
              onClick={() =>
                save.run(
                  () => saveDraftAction({ patientId, noteId: note.id, body }),
                  () => setMsg(tn("savedOk")),
                )
              }
            >
              {tn("saveDraft")}
            </Button>
          </div>
          <FormError message={save.error} />
          <FormSuccess message={msg} />
        </CardContent>
      </Card>

      <VisitExtras
        appointmentId={appointmentId}
        charges={charges}
        orders={orders}
        catalog={catalog}
        locked={false}
      />

      <Card className="border-brand">
        <CardContent className="flex flex-col gap-3 pt-4 md:pt-5">
          <p className="text-muted-foreground text-sm">
            {preparingFor ? t("postHintFor", { name: preparingFor }) : t("postHint")}
          </p>
          <Button
            className="self-start"
            disabled={!body.trim()}
            loading={post.pending}
            data-testid="post-visit"
            onClick={() => {
              if (!window.confirm(t("postConfirm"))) return;
              post.run(
                () => postVisitAction({ appointmentId, noteId: note.id, body }),
                () => router.push("/my-day"),
              );
            }}
          >
            {!post.pending && <Check />}
            {t("post")}
          </Button>
          <FormError message={post.error} />
        </CardContent>
      </Card>
    </div>
  );
}

/** Orders and invoice codes: editable while the visit is open, read-only once posted. */
export function VisitExtras({
  appointmentId,
  charges,
  orders,
  catalog,
  locked,
}: {
  appointmentId: string;
  charges: ChargeView[];
  orders: OrderView[];
  catalog: Catalog;
  locked: boolean;
}) {
  return (
    <>
      <OrdersCard appointmentId={appointmentId} orders={orders} catalog={catalog} locked={locked} />
      <ChargesCard
        appointmentId={appointmentId}
        charges={charges}
        catalog={catalog}
        locked={locked}
      />
    </>
  );
}

function OrdersCard({
  appointmentId,
  orders,
  catalog,
  locked,
}: {
  appointmentId: string;
  orders: OrderView[];
  catalog: Catalog;
  locked: boolean;
}) {
  const t = useTranslations("visit");
  const L = useL();
  const act = useAction();
  const blank = {
    kind: "medication" as "medication" | "treatment",
    name: "",
    dose: "",
    frequency: "",
    duration: "",
    sessions: "",
    intervalWeeks: "",
    serviceId: "",
    instructions: "",
  };
  const [v, setV] = useState(blank);
  const [adding, setAdding] = useState(false);
  const svc = (id: string | null) => catalog.services.find((s) => s.id === id);
  const num = (x: string) => (x.trim() ? Number(x) : null);

  return (
    <Card data-testid="visit-orders">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Pill className="size-4" aria-hidden />
          {t("orders")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {orders.length === 0 && <p className="text-muted-foreground text-sm">{t("noOrders")}</p>}
        <ul className="flex flex-col gap-2">
          {orders.map((o) => (
            <li key={o.id} className="bg-muted flex items-start gap-2 rounded-lg px-3 py-2 text-sm">
              {o.kind === "medication" ? (
                <Pill className="mt-0.5 size-4 shrink-0" aria-hidden />
              ) : (
                <Repeat className="mt-0.5 size-4 shrink-0" aria-hidden />
              )}
              <div className="flex min-w-0 flex-1 flex-col">
                <span className="font-medium">{o.name}</span>
                <span className="text-muted-foreground text-xs">
                  {o.kind === "medication"
                    ? [o.dose, o.frequency, o.duration].filter(Boolean).join(" · ")
                    : t("planLine", {
                        sessions: o.sessions ?? "—",
                        weeks: o.intervalWeeks ?? "—",
                        service: o.serviceId
                          ? L(svc(o.serviceId)?.nameAr, svc(o.serviceId)?.nameEn)
                          : "",
                      })}
                </span>
                {o.instructions && <span className="text-xs">{o.instructions}</span>}
              </div>
              {!locked && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("remove")}
                  disabled={act.pending}
                  onClick={() =>
                    act.run(() => removeVisitOrderAction({ appointmentId, orderId: o.id }))
                  }
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
        {!locked &&
          (adding ? (
            <form
              className="flex flex-col gap-3 rounded-lg border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                act.run(
                  () =>
                    addVisitOrderAction({
                      appointmentId,
                      kind: v.kind,
                      name: v.name,
                      dose: v.dose || null,
                      frequency: v.frequency || null,
                      duration: v.duration || null,
                      sessions: num(v.sessions),
                      intervalWeeks: num(v.intervalWeeks),
                      serviceId: v.serviceId || null,
                      instructions: v.instructions || null,
                    }),
                  () => {
                    setV({ ...blank, kind: v.kind });
                    setAdding(false);
                  },
                );
              }}
            >
              <div className="flex gap-2" role="radiogroup">
                {(["medication", "treatment"] as const).map((k) => (
                  <Button
                    key={k}
                    type="button"
                    size="sm"
                    variant={v.kind === k ? "outline" : "ghost"}
                    aria-pressed={v.kind === k}
                    onClick={() => setV({ ...v, kind: k })}
                  >
                    {t(k === "medication" ? "medication" : "treatmentPlan")}
                  </Button>
                ))}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field id="o-name" label={t(v.kind === "medication" ? "medName" : "planName")}>
                  <Input
                    id="o-name"
                    required
                    value={v.name}
                    onChange={(e) => setV({ ...v, name: e.target.value })}
                    data-testid="order-name"
                  />
                </Field>
                {v.kind === "medication" ? (
                  <>
                    <Field id="o-dose" label={t("dose")}>
                      <Input
                        id="o-dose"
                        value={v.dose}
                        onChange={(e) => setV({ ...v, dose: e.target.value })}
                      />
                    </Field>
                    <Field id="o-freq" label={t("frequency")}>
                      <Input
                        id="o-freq"
                        value={v.frequency}
                        onChange={(e) => setV({ ...v, frequency: e.target.value })}
                      />
                    </Field>
                    <Field id="o-dur" label={t("duration")}>
                      <Input
                        id="o-dur"
                        value={v.duration}
                        onChange={(e) => setV({ ...v, duration: e.target.value })}
                      />
                    </Field>
                  </>
                ) : (
                  <>
                    <Field id="o-svc" label={t("planService")}>
                      <Select
                        id="o-svc"
                        value={v.serviceId}
                        onChange={(e) => setV({ ...v, serviceId: e.target.value })}
                      >
                        <option value="">—</option>
                        {catalog.services.map((s) => (
                          <option key={s.id} value={s.id}>
                            {L(s.nameAr, s.nameEn)}
                          </option>
                        ))}
                      </Select>
                    </Field>
                    <Field id="o-sessions" label={t("sessions")}>
                      <Input
                        id="o-sessions"
                        type="number"
                        min={1}
                        max={50}
                        dir="ltr"
                        value={v.sessions}
                        onChange={(e) => setV({ ...v, sessions: e.target.value })}
                      />
                    </Field>
                    <Field id="o-weeks" label={t("intervalWeeks")}>
                      <Input
                        id="o-weeks"
                        type="number"
                        min={1}
                        max={104}
                        dir="ltr"
                        value={v.intervalWeeks}
                        onChange={(e) => setV({ ...v, intervalWeeks: e.target.value })}
                      />
                    </Field>
                  </>
                )}
              </div>
              <Field id="o-ins" label={t("instructions")}>
                <Input
                  id="o-ins"
                  value={v.instructions}
                  onChange={(e) => setV({ ...v, instructions: e.target.value })}
                />
              </Field>
              <div className="flex gap-2">
                <Button
                  type="submit"
                  size="sm"
                  variant="outline"
                  loading={act.pending}
                  data-testid="order-add"
                >
                  {t("add")}
                </Button>
                <Button type="button" size="sm" variant="ghost" onClick={() => setAdding(false)}>
                  {t("cancel")}
                </Button>
              </div>
            </form>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setAdding(true)}
            >
              <Plus />
              {t("addOrder")}
            </Button>
          ))}
        {!locked && <p className="text-muted-foreground text-xs">{t("ordersHint")}</p>}
        <FormError message={act.error} />
      </CardContent>
    </Card>
  );
}

function ChargesCard({
  appointmentId,
  charges,
  catalog,
  locked,
}: {
  appointmentId: string;
  charges: ChargeView[];
  catalog: Catalog;
  locked: boolean;
}) {
  const t = useTranslations("visit");
  const L = useL();
  const act = useAction();
  const [pick, setPick] = useState("");
  const [qty, setQty] = useState("1");
  const total = charges.reduce(
    (s, c) => s + (c.coveredByPackage ? 0 : c.quantity * c.unitPriceHalalas),
    0,
  );

  return (
    <Card data-testid="visit-charges">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Receipt className="size-4" aria-hidden />
          {t("charges")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {charges.length === 0 && <p className="text-muted-foreground text-sm">{t("noCharges")}</p>}
        <ul className="flex flex-col divide-y rounded-lg border">
          {charges.map((c) => (
            <li
              key={c.id}
              className="flex items-center gap-2 px-3 py-2 text-sm"
              data-testid="charge-line"
            >
              <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                {c.code}
              </span>
              <span className="min-w-0 flex-1">{L(c.nameAr, c.nameEn)}</span>
              <span className="text-muted-foreground text-xs" dir="ltr">
                {c.quantity} × {sar(c.unitPriceHalalas)}
              </span>
              {c.coveredByPackage ? (
                <Badge variant="gold">{t("package")}</Badge>
              ) : (
                <span className="font-medium" dir="ltr">
                  {sar(c.quantity * c.unitPriceHalalas)}
                </span>
              )}
              {!locked && (
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={t("remove")}
                  disabled={act.pending}
                  onClick={() =>
                    act.run(() => removeVisitChargeAction({ appointmentId, chargeId: c.id }))
                  }
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
          {charges.length > 0 && (
            <li className="flex items-center justify-between px-3 py-2 text-sm font-semibold">
              <span>{t("total")}</span>
              <span dir="ltr" data-testid="charges-total">
                {sar(total)} {t("sar")}
              </span>
            </li>
          )}
        </ul>
        {!locked && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              const [kind, id] = pick.split(":");
              act.run(
                () =>
                  addVisitChargeAction({
                    appointmentId,
                    serviceId: kind === "s" ? id : null,
                    billingItemId: kind === "i" ? id : null,
                    quantity: Number(qty) || 1,
                  }),
                () => {
                  setPick("");
                  setQty("1");
                },
              );
            }}
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor={`c-pick-${appointmentId}`}>{t("addCode")}</Label>
              <Select
                id={`c-pick-${appointmentId}`}
                value={pick}
                onChange={(e) => setPick(e.target.value)}
                data-testid="charge-pick"
              >
                <option value="">—</option>
                <optgroup label={t("fromPriceList")}>
                  {catalog.items.map((i) => (
                    <option key={i.id} value={`i:${i.id}`}>
                      {i.code} · {L(i.nameAr, i.nameEn)} · {sar(i.priceHalalas)}
                    </option>
                  ))}
                </optgroup>
                <optgroup label={t("fromServices")}>
                  {catalog.services.map((s) => (
                    <option key={s.id} value={`s:${s.id}`}>
                      {s.code} · {L(s.nameAr, s.nameEn)} · {sar(s.priceHalalas)}
                    </option>
                  ))}
                </optgroup>
              </Select>
            </div>
            <div className="flex w-20 flex-col gap-1">
              <Label htmlFor={`c-qty-${appointmentId}`}>{t("qty")}</Label>
              <Input
                id={`c-qty-${appointmentId}`}
                type="number"
                min={1}
                max={1000}
                dir="ltr"
                value={qty}
                onChange={(e) => setQty(e.target.value)}
                data-testid="charge-qty"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="outline"
              disabled={!pick}
              loading={act.pending}
              data-testid="charge-add"
            >
              <Plus />
              {t("add")}
            </Button>
          </form>
        )}
        <FormError message={act.error} />
      </CardContent>
    </Card>
  );
}

function Field({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label htmlFor={id}>{label}</Label>
      {children}
    </div>
  );
}
