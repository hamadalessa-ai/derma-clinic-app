"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { FileText, FlaskRound, Paperclip, Plus, X } from "lucide-react";
import {
  addLabReportAction,
  cancelLabRequestAction,
  requestLabRepeatAction,
  voidLabReportAction,
} from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Locale } from "@/i18n/config";
import { formatGregorian } from "@/lib/format";
import type { LabsView } from "@/lib/labs/labs";
import { LAB_PRESETS } from "@/lib/labs/presets";
import { cn } from "@/lib/utils";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Report = LabsView["reports"][number];
type Request = LabsView["requests"][number];

const FLAG_TONE: Record<string, string> = {
  low: "bg-warning text-warning-foreground",
  high: "bg-warning text-warning-foreground",
  abnormal: "bg-destructive/10 text-destructive",
  normal: "bg-muted text-muted-foreground",
};

const day = (d: string) => new Date(`${d}T12:00:00+03:00`);
const todayIso = () => new Date(Date.now() + 3 * 3600_000).toISOString().slice(0, 10);
const addMonths = (months: number) => {
  const d = new Date(Date.now() + 3 * 3600_000);
  d.setUTCMonth(d.getUTCMonth() + months);
  return d.toISOString().slice(0, 10);
};
const range = (lo: number | null, hi: number | null) =>
  lo != null && hi != null ? `${lo}–${hi}` : lo != null ? `≥ ${lo}` : hi != null ? `≤ ${hi}` : "";

/**
 * Lab results for one patient (doctors and nurses): repeat tests due, results newest first with
 * low / high flags and the lab's report, "Add results" and "Request repeat test". On the patient
 * file (Labs tab) and, compact, on the visit screen.
 */
export function LabResults({
  patientId,
  appointmentId,
  data,
  canEdit,
  compact,
}: {
  patientId: string;
  appointmentId?: string | null;
  data: LabsView;
  canEdit: boolean;
  /** Visit screen: the last two reports only. */
  compact?: boolean;
}) {
  const t = useTranslations("labs");
  const locale = useLocale() as Locale;
  const date = (d: string) => formatGregorian(day(d), locale, "medium");
  const [adding, setAdding] = useState(false);
  const open = data.requests.filter((r) => r.state !== "done" && r.state !== "cancelled");
  const reports = compact ? data.reports.filter((r) => !r.voided).slice(0, 2) : data.reports;

  // On the visit screen with nothing to show: one line (title + "Add results"); repeat-test
  // requests are made from the patient file's Labs tab.
  const quiet = !!compact && !reports.length && !open.length && !adding;

  return (
    <Card data-testid="lab-results">
      <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="flex items-center gap-2 text-base">
          <FlaskRound className="text-brand-strong size-4" />
          {t("title")}
        </CardTitle>
        {quiet && canEdit && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAdding(true)}
            data-testid="lab-add-open"
          >
            <Plus />
            {t("add")}
          </Button>
        )}
      </CardHeader>
      {!quiet && (
      <CardContent className="flex flex-col gap-4">
        {(open.length > 0 || canEdit) && (
          <Requests
            patientId={patientId}
            appointmentId={appointmentId ?? null}
            requests={open}
            canEdit={canEdit}
            date={date}
          />
        )}

        {canEdit &&
          (adding ? (
            <AddResults
              patientId={patientId}
              appointmentId={appointmentId ?? null}
              onDone={() => setAdding(false)}
            />
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="self-start"
              onClick={() => setAdding(true)}
              data-testid="lab-add-open"
            >
              <Plus />
              {t("add")}
            </Button>
          ))}

        {reports.length ? (
          <ul className="flex flex-col gap-3">
            {reports.map((r) => (
              <ReportCard
                key={r.id}
                r={r}
                patientId={patientId}
                appointmentId={appointmentId ?? null}
                canEdit={canEdit}
                date={date}
                locale={locale}
              />
            ))}
          </ul>
        ) : compact ? (
          <p className="text-muted-foreground text-sm">{t("none")}</p>
        ) : (
          <EmptyState icon={<FlaskRound />} title={t("none")} />
        )}
      </CardContent>
      )}
    </Card>
  );
}

function Requests({
  patientId,
  appointmentId,
  requests,
  canEdit,
  date,
}: {
  patientId: string;
  appointmentId: string | null;
  requests: Request[];
  canEdit: boolean;
  date: (d: string) => string;
}) {
  const t = useTranslations("labs");
  const act = useAction();
  const add = useAction();
  const [open, setOpen] = useState(false);
  const [testName, setTestName] = useState("");
  const [dueOn, setDueOn] = useState(addMonths(3));
  const [msg, setMsg] = useState<string | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="lab-requests">
      {requests.length > 0 && (
        <ul className="flex flex-col divide-y rounded-lg border">
          {requests.map((q) => (
            <li
              key={q.id}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm"
              data-testid="lab-request"
              data-state={q.state}
            >
              <span className="font-medium">{t("repeat", { test: q.testName })}</span>
              <span
                className={cn(
                  "rounded-md px-2 text-xs leading-6",
                  q.state === "overdue"
                    ? "bg-warning text-warning-foreground font-medium"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {t(q.state === "overdue" ? "overdueOn" : "dueOn", { date: date(q.dueOn) })}
              </span>
              {q.reason && <span className="text-muted-foreground text-xs">{q.reason}</span>}
              {canEdit && (
                <Button
                  size="icon"
                  variant="ghost"
                  className="ms-auto"
                  aria-label={t("cancelRequest")}
                  title={t("cancelRequest")}
                  loading={act.pending}
                  onClick={() =>
                    act.run(() =>
                      cancelLabRequestAction({ requestId: q.id, patientId, appointmentId }),
                    )
                  }
                >
                  <X />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <FormError message={act.error} />
      {canEdit &&
        (open ? (
          <form
            className="flex flex-wrap items-end gap-2 rounded-lg border p-3"
            onSubmit={(e) => {
              e.preventDefault();
              add.run(
                () =>
                  requestLabRepeatAction({
                    patientId,
                    testName,
                    dueOn,
                    appointmentId,
                  }),
                () => {
                  setOpen(false);
                  setTestName("");
                  setMsg(t("requested"));
                },
              );
            }}
            data-testid="lab-request-form"
          >
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor="lab-req-test">{t("test")}</Label>
              <Input
                id="lab-req-test"
                list="lab-presets"
                value={testName}
                onChange={(e) => setTestName(e.target.value)}
                required
                maxLength={120}
                dir="auto"
              />
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="lab-req-due">{t("due")}</Label>
              <Input
                id="lab-req-due"
                type="date"
                value={dueOn}
                min={todayIso()}
                onChange={(e) => setDueOn(e.target.value)}
                required
                dir="ltr"
              />
            </div>
            <div className="flex gap-1">
              {[1, 3, 6].map((m) => (
                <Button
                  key={m}
                  type="button"
                  size="sm"
                  variant="ghost"
                  onClick={() => setDueOn(addMonths(m))}
                >
                  {t("inMonths", { n: m })}
                </Button>
              ))}
            </div>
            <Button type="submit" variant="outline" loading={add.pending}>
              {t("request")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              {t("close")}
            </Button>
            <FormError message={add.error} />
            <PresetList />
          </form>
        ) : (
          <Button
            size="sm"
            variant="ghost"
            className="self-start"
            onClick={() => setOpen(true)}
            data-testid="lab-request-open"
          >
            <Plus />
            {t("requestRepeat")}
          </Button>
        ))}
      <FormSuccess message={msg} />
    </div>
  );
}

function ReportCard({
  r,
  patientId,
  appointmentId,
  canEdit,
  date,
  locale,
}: {
  r: Report;
  patientId: string;
  appointmentId: string | null;
  canEdit: boolean;
  date: (d: string) => string;
  locale: Locale;
}) {
  const t = useTranslations("labs");
  const act = useAction();
  const [voiding, setVoiding] = useState(false);
  const [reason, setReason] = useState("");
  const by = locale === "en" && r.enteredByEn ? r.enteredByEn : r.enteredBy;
  return (
    <li
      className={cn("flex flex-col gap-2 rounded-lg border p-3", r.voided && "opacity-60")}
      data-testid="lab-report"
      data-voided={r.voided || undefined}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={cn("font-semibold", r.voided && "line-through")}>{date(r.takenOn)}</span>
        {r.labName && <span className="text-muted-foreground text-sm">{r.labName}</span>}
        <span className="text-muted-foreground text-xs">{t("enteredBy", { name: by })}</span>
        {r.fileId && (
          <a
            href={`/api/files/${r.fileId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-brand-strong ms-auto inline-flex items-center gap-1 text-sm hover:underline"
            data-testid="lab-file"
          >
            <FileText className="size-4" />
            {t("viewReport")}
          </a>
        )}
      </div>
      {r.voided && (
        <p className="text-muted-foreground text-xs">
          {t("voided", { reason: r.voidReason ?? "" })}
        </p>
      )}
      {r.values.length > 0 && (
        <table className="w-full text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="py-1 text-start font-medium">{t("test")}</th>
              <th className="py-1 text-start font-medium">{t("value")}</th>
              <th className="py-1 text-start font-medium">{t("range")}</th>
              <th className="py-1" />
            </tr>
          </thead>
          <tbody className="divide-y">
            {r.values.map((v) => (
              <tr key={v.id} data-testid="lab-value" data-flag={v.flag}>
                <td className="py-1.5 pe-2" dir="auto">
                  {v.testName}
                </td>
                <td className="py-1.5 pe-2 font-medium tabular-nums" dir="ltr">
                  {v.valueText} {v.unit && <span className="text-muted-foreground">{v.unit}</span>}
                </td>
                <td className="text-muted-foreground py-1.5 pe-2 tabular-nums" dir="ltr">
                  {range(v.refLow, v.refHigh)}
                </td>
                <td className="py-1.5 text-end">
                  {v.flag !== "none" && (
                    <span className={cn("rounded-md px-2 text-xs leading-6", FLAG_TONE[v.flag])}>
                      {t(`flag.${v.flag}`)}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {r.note && (
        <p className="text-muted-foreground text-sm" dir="auto">
          {r.note}
        </p>
      )}
      {canEdit && !r.voided && (
        <div className="flex flex-wrap items-center gap-2">
          {voiding ? (
            <>
              <Input
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("voidReason")}
                maxLength={300}
                className="min-w-48 flex-1"
                dir="auto"
              />
              <Button
                size="sm"
                variant="outline"
                loading={act.pending}
                disabled={!reason.trim()}
                onClick={() =>
                  act.run(() =>
                    voidLabReportAction({ reportId: r.id, reason, patientId, appointmentId }),
                  )
                }
                data-testid="lab-void-yes"
              >
                {t("void")}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setVoiding(false)}>
                {t("close")}
              </Button>
            </>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-muted-foreground"
              onClick={() => setVoiding(true)}
            >
              {t("voidOpen")}
            </Button>
          )}
          <FormError message={act.error} />
        </div>
      )}
    </li>
  );
}

interface Row {
  testName: string;
  valueText: string;
  unit: string;
  refLow: string;
  refHigh: string;
}
const emptyRow = (): Row => ({ testName: "", valueText: "", unit: "", refLow: "", refHigh: "" });
const num = (s: string) => (s.trim() === "" || !Number.isFinite(Number(s)) ? null : Number(s));

function AddResults({
  patientId,
  appointmentId,
  onDone,
}: {
  patientId: string;
  appointmentId: string | null;
  onDone: () => void;
}) {
  const t = useTranslations("labs");
  const act = useAction();
  const [takenOn, setTakenOn] = useState(todayIso());
  const [labName, setLabName] = useState("");
  const [note, setNote] = useState("");
  const [rows, setRows] = useState<Row[]>([emptyRow(), emptyRow(), emptyRow()]);
  const [file, setFile] = useState<File | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const setRow = (i: number, patch: Partial<Row>) =>
    setRows((rs) =>
      rs.map((r, j) => {
        if (j !== i) return r;
        const next = { ...r, ...patch };
        // A known test fills its usual unit and range (only empty fields).
        if (patch.testName !== undefined) {
          const p = LAB_PRESETS.find(
            (x) => x.name.toLowerCase() === patch.testName!.trim().toLowerCase(),
          );
          if (p) {
            if (!r.unit) next.unit = p.unit;
            if (!r.refLow && p.low != null) next.refLow = String(p.low);
            if (!r.refHigh && p.high != null) next.refHigh = String(p.high);
          }
        }
        return next;
      }),
    );

  async function submit() {
    setUploadError(null);
    let fileId: string | null = null;
    if (file) {
      setUploading(true);
      const body = new FormData();
      body.set("file", file);
      const res = await fetch("/api/labs/upload", { method: "POST", body }).catch(() => null);
      setUploading(false);
      if (!res?.ok) {
        setUploadError(t("uploadFailed"));
        return;
      }
      fileId = ((await res.json()) as { id: string }).id;
    }
    act.run(
      () =>
        addLabReportAction({
          patientId,
          appointmentId,
          takenOn,
          labName: labName || null,
          note: note || null,
          fileId,
          values: rows
            .filter((r) => r.testName.trim() && r.valueText.trim())
            .map((r) => ({
              testName: r.testName,
              valueText: r.valueText,
              unit: r.unit || null,
              refLow: num(r.refLow),
              refHigh: num(r.refHigh),
            })),
        }),
      onDone,
    );
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-lg border p-3"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
      data-testid="lab-add"
    >
      <div className="flex flex-wrap gap-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="lab-date">{t("takenOn")}</Label>
          <Input
            id="lab-date"
            type="date"
            value={takenOn}
            max={todayIso()}
            onChange={(e) => setTakenOn(e.target.value)}
            required
            dir="ltr"
          />
        </div>
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor="lab-name">{t("lab")}</Label>
          <Input
            id="lab-name"
            value={labName}
            onChange={(e) => setLabName(e.target.value)}
            maxLength={120}
            dir="auto"
          />
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[560px] text-sm">
          <thead className="text-muted-foreground text-xs">
            <tr>
              <th className="pb-1 text-start font-medium">{t("test")}</th>
              <th className="pb-1 text-start font-medium">{t("value")}</th>
              <th className="pb-1 text-start font-medium">{t("unit")}</th>
              <th className="pb-1 text-start font-medium">{t("low")}</th>
              <th className="pb-1 text-start font-medium">{t("high")}</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} data-testid="lab-row">
                <td className="pe-1 pb-1">
                  <Input
                    list="lab-presets"
                    value={r.testName}
                    onChange={(e) => setRow(i, { testName: e.target.value })}
                    aria-label={t("test")}
                    maxLength={120}
                    dir="auto"
                    data-testid="lab-row-test"
                  />
                </td>
                <td className="pe-1 pb-1">
                  <Input
                    value={r.valueText}
                    onChange={(e) => setRow(i, { valueText: e.target.value })}
                    aria-label={t("value")}
                    maxLength={60}
                    className="w-24"
                    dir="ltr"
                    data-testid="lab-row-value"
                  />
                </td>
                <td className="pe-1 pb-1">
                  <Input
                    value={r.unit}
                    onChange={(e) => setRow(i, { unit: e.target.value })}
                    aria-label={t("unit")}
                    maxLength={30}
                    className="w-24"
                    dir="ltr"
                  />
                </td>
                <td className="pe-1 pb-1">
                  <Input
                    value={r.refLow}
                    onChange={(e) => setRow(i, { refLow: e.target.value })}
                    aria-label={t("low")}
                    inputMode="decimal"
                    className="w-20"
                    dir="ltr"
                  />
                </td>
                <td className="pe-1 pb-1">
                  <Input
                    value={r.refHigh}
                    onChange={(e) => setRow(i, { refHigh: e.target.value })}
                    aria-label={t("high")}
                    inputMode="decimal"
                    className="w-20"
                    dir="ltr"
                  />
                </td>
                <td className="pb-1">
                  {rows.length > 1 && (
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      aria-label={t("removeRow")}
                      onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
                    >
                      <X />
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        className="self-start"
        onClick={() => setRows((rs) => [...rs, emptyRow()])}
      >
        <Plus />
        {t("addRow")}
      </Button>

      <div className="flex flex-wrap items-end gap-3">
        <div className="flex min-w-48 flex-1 flex-col gap-1">
          <Label htmlFor="lab-note">{t("note")}</Label>
          <Input
            id="lab-note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={1000}
            dir="auto"
          />
        </div>
        <label className="text-brand-strong inline-flex cursor-pointer items-center gap-2 text-sm">
          <Paperclip className="size-4" />
          {file ? file.name : t("attach")}
          <input
            type="file"
            accept="application/pdf,image/jpeg,image/png,image/webp,image/heic"
            className="sr-only"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            data-testid="lab-file-input"
          />
        </label>
      </div>
      <p className="text-muted-foreground text-xs">{t("rangeHint")}</p>
      <div className="flex gap-2">
        <Button type="submit" loading={act.pending || uploading} data-testid="lab-add-submit">
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={onDone}>
          {t("close")}
        </Button>
      </div>
      <FormError message={uploadError ?? act.error} />
      <PresetList />
    </form>
  );
}

function PresetList() {
  return (
    <datalist id="lab-presets">
      {LAB_PRESETS.map((p) => (
        <option key={p.name} value={p.name} />
      ))}
    </datalist>
  );
}
