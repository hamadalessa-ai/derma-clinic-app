"use client";

import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { recordToothAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  currentChart,
  LOWER_TEETH,
  NEEDS_TREATMENT,
  SURFACES,
  TOOTH_CONDITIONS,
  UPPER_TEETH,
  type ToothCondition,
} from "@/lib/dental/teeth";
import { cn } from "@/lib/utils";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

export interface ChartEntryView {
  id: string;
  tooth: number;
  condition: ToothCondition;
  surfaces: string;
  note: string | null;
  createdAt: string;
  recordedByName: string;
}

/** How a tooth looks on the chart (theme tokens only). */
function toneOf(c: ToothCondition | undefined) {
  if (!c) return "bg-card";
  if ((NEEDS_TREATMENT as readonly string[]).includes(c))
    return "bg-warning text-warning-foreground border-warning-foreground";
  if (c === "missing") return "bg-muted text-muted-foreground border-dashed";
  if (c === "watch") return "bg-card border-brand-strong border-dashed";
  return "bg-brand-soft text-brand-strong border-brand-strong";
}

/**
 * The dental chart (FDI), as the dentist faces the patient: upper 18→11 | 21→28,
 * lower 48→41 | 31→38. Tap a tooth to see its history and (doctors and nurses) record a change.
 */
export function ToothChart({
  patientId,
  entries,
  editable,
  appointmentId,
}: {
  patientId: string;
  entries: ChartEntryView[];
  editable: boolean;
  /** The visit this is recorded in (visit screen). */
  appointmentId?: string | null;
}) {
  const t = useTranslations("dental");
  const locale = useLocale();
  const now = useMemo(() => currentChart(entries), [entries]);
  const [selected, setSelected] = useState<number | null>(null);

  const tooth = (n: number) => {
    const e = now.get(n);
    return (
      <button
        key={n}
        type="button"
        onClick={() => setSelected(n === selected ? null : n)}
        aria-pressed={selected === n}
        aria-label={`${n}${e ? ` — ${t(`cond.${e.condition}`)}` : ""}`}
        className={cn(
          "flex h-14 flex-col items-center justify-center rounded-lg border text-xs transition-shadow",
          toneOf(e?.condition),
          selected === n && "ring-brand-strong ring-2 ring-offset-1",
        )}
        data-testid="tooth"
        data-tooth={n}
        data-condition={e?.condition ?? "healthy"}
      >
        <span className="font-mono font-semibold">{n}</span>
        <span className="leading-4">{e ? t(`short.${e.condition}`) : ""}</span>
        {e?.surfaces && <span className="font-mono text-[10px] leading-3">{e.surfaces}</span>}
      </button>
    );
  };

  return (
    <Card data-testid="tooth-chart">
      <CardHeader>
        <CardTitle className="text-base">{t("chart")}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="overflow-x-auto" dir="ltr">
          <div className="flex min-w-[640px] flex-col gap-2">
            <div className="text-muted-foreground flex justify-between text-[11px]">
              <span>{t("patientRight")}</span>
              <span>{t("upper")}</span>
              <span>{t("patientLeft")}</span>
            </div>
            <div className="grid grid-cols-16 gap-1">{UPPER_TEETH.map(tooth)}</div>
            <div className="bg-border h-px" />
            <div className="grid grid-cols-16 gap-1">{LOWER_TEETH.map(tooth)}</div>
            <div className="text-muted-foreground text-center text-[11px]">{t("lower")}</div>
          </div>
        </div>

        <div className="text-muted-foreground flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <span className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border", toneOf("caries"))} />
            {t("legendTreat")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border", toneOf("filled"))} />
            {t("legendDone")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border", toneOf("missing"))} />
            {t("cond.missing")}
          </span>
          <span className="flex items-center gap-1.5">
            <span className={cn("size-3 rounded border", toneOf("watch"))} />
            {t("cond.watch")}
          </span>
        </div>

        {selected !== null && (
          <ToothPanel
            key={selected}
            tooth={selected}
            patientId={patientId}
            current={now.get(selected)}
            history={entries.filter((e) => e.tooth === selected)}
            editable={editable}
            appointmentId={appointmentId ?? null}
            locale={locale}
          />
        )}
      </CardContent>
    </Card>
  );
}

function ToothPanel({
  tooth,
  patientId,
  current,
  history,
  editable,
  appointmentId,
  locale,
}: {
  tooth: number;
  patientId: string;
  current: ChartEntryView | undefined;
  history: ChartEntryView[];
  editable: boolean;
  appointmentId: string | null;
  locale: string;
}) {
  const t = useTranslations("dental");
  const act = useAction();
  const [condition, setCondition] = useState<ToothCondition>(current?.condition ?? "caries");
  const [surfaces, setSurfaces] = useState(current?.surfaces ?? "");
  const [note, setNote] = useState("");
  const toggle = (s: string) =>
    setSurfaces((v) => (v.includes(s) ? v.replace(s, "") : v + s));
  const fmt = new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "ar-SA-u-ca-gregory", {
    dateStyle: "medium",
    timeZone: "Asia/Riyadh",
  });

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-3" data-testid="tooth-panel">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{t("toothN", { n: tooth })}</span>
        <span className="text-muted-foreground text-sm">
          {current ? t(`cond.${current.condition}`) : t("cond.healthy")}
          {current?.surfaces ? ` · ${current.surfaces}` : ""}
        </span>
      </div>

      {editable && (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            act.run(
              () =>
                recordToothAction({
                  patientId,
                  tooth,
                  condition,
                  surfaces: condition === "missing" || condition === "healthy" ? "" : surfaces,
                  note: note || null,
                  appointmentId,
                }),
              () => setNote(""),
            );
          }}
        >
          <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("condition")}>
            {TOOTH_CONDITIONS.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={condition === c}
                onClick={() => setCondition(c)}
                className={cn(
                  "rounded-lg border px-2.5 py-1 text-xs",
                  condition === c ? toneOf(c === "healthy" ? undefined : c) : "bg-card",
                  condition === c && "ring-brand-strong ring-1",
                )}
                data-testid="condition"
                data-value={c}
              >
                {t(`cond.${c}`)}
              </button>
            ))}
          </div>
          {condition !== "missing" && condition !== "healthy" && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-muted-foreground text-xs">{t("surfaces")}</span>
              {SURFACES.map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={surfaces.includes(s)}
                  onClick={() => toggle(s)}
                  title={t(`surface.${s}`)}
                  className={cn(
                    "size-8 rounded-lg border font-mono text-xs",
                    surfaces.includes(s) ? "bg-brand-soft text-brand-strong border-brand-strong" : "bg-card",
                  )}
                  data-testid="surface"
                >
                  {s}
                </button>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t("notePlaceholder")}
              maxLength={300}
              className="min-w-48 flex-1"
              dir="auto"
            />
            <Button
              type="submit"
              variant="outline"
              loading={act.pending}
              data-testid="tooth-save"
            >
              {!act.pending && <Check />}
              {t("record")}
            </Button>
          </div>
          <FormError message={act.error} />
        </form>
      )}

      {history.length > 0 && (
        <ul className="text-muted-foreground flex flex-col gap-1 border-t pt-2 text-xs">
          {[...history].reverse().map((h) => (
            <li key={h.id}>
              <span className="text-foreground">{t(`cond.${h.condition}`)}</span>
              {h.surfaces ? ` · ${h.surfaces}` : ""}
              {h.note ? (
                <>
                  {" · "}
                  <bdi>{h.note}</bdi>
                </>
              ) : null}
              {" — "}
              <bdi>{h.recordedByName}</bdi>, {fmt.format(new Date(h.createdAt))}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
