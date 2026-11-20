"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check, ClipboardList, Plus, X } from "lucide-react";
import { addPlanItemAction, cancelPlanItemAction, planDoneAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { ALL_TEETH } from "@/lib/dental/teeth";
import { cn } from "@/lib/utils";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

export interface PlanItemView {
  id: string;
  tooth: number | null;
  surfaces: string;
  code: string;
  nameAr: string;
  nameEn: string;
  priceHalalas: number;
  status: "planned" | "done" | "cancelled";
  doneAt: string | null;
}
export interface DentalServiceOption {
  id: string;
  nameAr: string;
  nameEn: string;
  priceHalalas: number;
}

const sar = (h: number) => (h / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });

/**
 * Dental treatment plan across visits: what is planned per tooth, what is done, and the
 * estimate. Doctors and nurses add / finish / cancel; "Done in this visit" (visit screen) also
 * adds the procedure to the visit's invoice codes. Reception sees it read-only.
 */
export function DentalPlan({
  patientId,
  items,
  services,
  canEdit,
  appointmentId,
}: {
  patientId: string;
  items: PlanItemView[];
  services: DentalServiceOption[];
  canEdit: boolean;
  /** An open visit: "Done in this visit" is offered. */
  appointmentId?: string | null;
}) {
  const t = useTranslations("dental");
  const locale = useLocale();
  const name = (o: { nameAr: string; nameEn: string }) => (locale === "en" ? o.nameEn : o.nameAr);
  const act = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const shown = items.filter((i) => i.status !== "cancelled");
  const planned = shown.filter((i) => i.status === "planned");
  const total = (st: string) =>
    shown.filter((i) => i.status === st).reduce((s, i) => s + i.priceHalalas, 0);

  return (
    <Card data-testid="dental-plan">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <ClipboardList className="text-brand-strong size-4" />
          {t("plan")}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {shown.length ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {shown.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2"
                data-testid="plan-item"
                data-status={i.status}
              >
                <span className="text-muted-foreground w-10 font-mono text-xs" dir="ltr">
                  {i.tooth ?? "—"}
                </span>
                <span
                  className={cn("min-w-0 flex-1", i.status === "done" && "text-muted-foreground")}
                >
                  {name(i)}
                  {i.surfaces ? (
                    <span className="text-muted-foreground font-mono text-xs"> · {i.surfaces}</span>
                  ) : null}
                </span>
                <span className="text-sm tabular-nums" dir="ltr">
                  {sar(i.priceHalalas)}
                </span>
                {i.status === "done" ? (
                  <span className="bg-brand-soft text-brand-strong rounded-md px-2 text-xs leading-6">
                    {t("done")}
                  </span>
                ) : (
                  <span className="bg-muted text-muted-foreground rounded-md px-2 text-xs leading-6">
                    {t("planned")}
                  </span>
                )}
                {canEdit && i.status === "planned" && (
                  <span className="flex gap-1">
                    {appointmentId && (
                      <Button
                        size="sm"
                        variant="outline"
                        loading={act.pending && busy === `d${i.id}`}
                        data-testid="plan-done"
                        onClick={() => {
                          setBusy(`d${i.id}`);
                          act.run(() => planDoneAction({ patientId, itemId: i.id, appointmentId }));
                        }}
                      >
                        <Check />
                        {t("doneToday")}
                      </Button>
                    )}
                    <Button
                      size="icon"
                      variant="ghost"
                      aria-label={t("cancelItem")}
                      title={t("cancelItem")}
                      loading={act.pending && busy === `c${i.id}`}
                      onClick={() => {
                        setBusy(`c${i.id}`);
                        act.run(() =>
                          cancelPlanItemAction({ patientId, itemId: i.id, appointmentId }),
                        );
                      }}
                    >
                      <X />
                    </Button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noPlan")}</p>
        )}
        {shown.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm" data-testid="plan-totals">
            <span>
              {t("remaining", { n: planned.length })}:{" "}
              <b dir="ltr">
                {sar(total("planned"))} {t("sar")}
              </b>
            </span>
            <span className="text-muted-foreground">
              {t("doneTotal")}: <span dir="ltr">{sar(total("done"))}</span> {t("sar")}
            </span>
          </div>
        )}
        <FormError message={act.error} />
        {canEdit &&
          (adding ? (
            <AddPlanItem
              patientId={patientId}
              services={services}
              appointmentId={appointmentId ?? null}
              onDone={() => setAdding(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setAdding(true)}
              data-testid="plan-add-open"
            >
              <Plus />
              {t("addStep")}
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}

function AddPlanItem({
  patientId,
  services,
  appointmentId,
  onDone,
}: {
  patientId: string;
  services: DentalServiceOption[];
  appointmentId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("dental");
  const tc = useTranslations("visit");
  const locale = useLocale();
  const act = useAction();
  const [tooth, setTooth] = useState("");
  const [serviceId, setServiceId] = useState(services[0]?.id ?? "");
  const [surfaces, setSurfaces] = useState("");
  return (
    <form
      className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
      data-testid="plan-add"
      onSubmit={(e) => {
        e.preventDefault();
        if (!serviceId) return;
        act.run(
          () =>
            addPlanItemAction({
              patientId,
              serviceId,
              tooth: tooth ? Number(tooth) : null,
              surfaces,
              appointmentId,
            }),
          onDone,
        );
      }}
    >
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="plan-tooth">
          {t("tooth")}
        </label>
        <Select
          id="plan-tooth"
          value={tooth}
          onChange={(e) => setTooth(e.target.value)}
          className="w-24"
          data-testid="plan-tooth"
        >
          <option value="">—</option>
          {ALL_TEETH.map((n) => (
            <option key={n} value={n}>
              {n}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex min-w-48 flex-1 flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="plan-service">
          {t("procedure")}
        </label>
        <Select
          id="plan-service"
          value={serviceId}
          onChange={(e) => setServiceId(e.target.value)}
          data-testid="plan-service"
        >
          {services.map((s) => (
            <option key={s.id} value={s.id}>
              {locale === "en" ? s.nameEn : s.nameAr} · {sar(s.priceHalalas)}
            </option>
          ))}
        </Select>
      </div>
      <div className="flex flex-col gap-1">
        <label className="text-xs font-medium" htmlFor="plan-surfaces">
          {t("surfaces")}
        </label>
        <Input
          id="plan-surfaces"
          value={surfaces}
          onChange={(e) => setSurfaces(e.target.value.toUpperCase())}
          maxLength={5}
          placeholder="MOD"
          className="w-20 font-mono"
          dir="ltr"
        />
      </div>
      <Button type="submit" variant="outline" loading={act.pending} data-testid="plan-add-submit">
        {!act.pending && <Plus />}
        {tc("add")}
      </Button>
      <Button type="button" variant="ghost" onClick={onDone}>
        {tc("cancel")}
      </Button>
      <FormError message={act.error} />
    </form>
  );
}
