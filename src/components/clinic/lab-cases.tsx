"use client";

import { useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { FlaskConical, Plus } from "lucide-react";
import { createLabCaseAction, setLabStatusAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import type { LabStatus, LabWork } from "@/lib/dental/lab";
import { cn } from "@/lib/utils";
import { ContactButtons } from "./contact-buttons";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

export interface LabCaseView {
  id: string;
  patientId: string;
  patientName: string;
  fileNumber: string;
  phone: string;
  doctorName: string;
  labName: string;
  work: LabWork;
  teeth: string;
  shade: string | null;
  sentOn: string;
  dueOn: string;
  status: LabStatus;
  overdue: boolean;
  next: LabStatus[];
}

const STATUS_TONE: Record<LabStatus, string> = {
  sent: "bg-muted text-muted-foreground",
  remake: "bg-warning text-warning-foreground",
  received: "bg-brand-soft text-brand-strong",
  fitted: "bg-brand-soft text-brand-strong",
  cancelled: "bg-muted text-muted-foreground line-through",
};

/** Lab work list: due date, where it is now, one tap to move it on (received → fitted). */
export function LabCaseList({
  cases,
  showPatient,
  canWhatsApp,
}: {
  cases: LabCaseView[];
  showPatient: boolean;
  canWhatsApp: boolean;
}) {
  const t = useTranslations("dental");
  const act = useAction();
  const [busy, setBusy] = useState<string | null>(null);
  if (!cases.length) return <EmptyState icon={<FlaskConical />} title={t("noLab")} />;
  return (
    <>
      <ul className="flex flex-col divide-y rounded-lg border" data-testid="lab-cases">
        {cases.map((c) => (
          <li
            key={c.id}
            className={cn(
              "flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2",
              c.overdue && "bg-warning/40",
            )}
            data-testid="lab-case"
            data-status={c.status}
            data-overdue={c.overdue || undefined}
          >
            <div className="flex min-w-0 flex-1 flex-col">
              <span className="font-medium">
                {t(`work.${c.work}`)}
                {c.teeth ? <span className="font-mono text-xs"> · {c.teeth}</span> : null}
                {c.shade ? <span className="text-muted-foreground text-xs"> · {c.shade}</span> : null}
              </span>
              <span className="text-muted-foreground text-[13px]">
                {showPatient && (
                  <>
                    <Link href={`/patients/${c.patientId}`} className="hover:underline">
                      {c.patientName}
                    </Link>{" "}
                    <span className="font-mono text-xs" dir="ltr">
                      {c.fileNumber}
                    </span>
                    {" · "}
                  </>
                )}
                <bdi>{c.labName}</bdi> · <bdi>{c.doctorName}</bdi>
              </span>
            </div>
            <span className="text-[13px] tabular-nums" dir="ltr">
              {c.sentOn} → {c.dueOn}
            </span>
            {c.overdue && (
              <span className="bg-warning text-warning-foreground rounded-md px-2 text-xs leading-6 font-medium">
                {t("overdue")}
              </span>
            )}
            <span className={cn("rounded-md px-2 text-xs leading-6", STATUS_TONE[c.status])}>
              {t(`labStatus.${c.status}`)}
            </span>
            <span className="flex flex-wrap gap-1">
              {c.next.map((s) => (
                <Button
                  key={s}
                  size="sm"
                  variant={s === "cancelled" || s === "remake" ? "ghost" : "outline"}
                  loading={act.pending && busy === c.id + s}
                  data-testid="lab-next"
                  data-to={s}
                  onClick={() => {
                    setBusy(c.id + s);
                    act.run(() =>
                      setLabStatusAction({ id: c.id, status: s, patientId: c.patientId }),
                    );
                  }}
                >
                  {t(`labTo.${s}`)}
                </Button>
              ))}
              {showPatient && (
                <ContactButtons patientId={c.patientId} phone={c.phone} whatsapp={canWhatsApp} />
              )}
            </span>
          </li>
        ))}
      </ul>
      <FormError message={act.error} />
    </>
  );
}

/** Send work to a lab (doctor / nurse at the visit, or reception later). */
export function NewLabCase({
  patientId,
  doctors,
  defaultDoctorId,
  appointmentId,
  labs,
  today,
}: {
  patientId: string;
  doctors: { id: string; nameAr: string; nameEn: string | null }[];
  defaultDoctorId: string | null;
  appointmentId?: string | null;
  /** Labs used before (suggestions). */
  labs: string[];
  today: string;
}) {
  const t = useTranslations("dental");
  const tc = useTranslations("visit");
  const locale = useLocale();
  const act = useAction();
  const [open, setOpen] = useState(false);
  const plus = (d: string, n: number) => {
    const x = new Date(`${d}T12:00:00Z`);
    x.setUTCDate(x.getUTCDate() + n);
    return x.toISOString().slice(0, 10);
  };
  const [f, setF] = useState({
    practitionerId: defaultDoctorId ?? doctors[0]?.id ?? "",
    labName: labs[0] ?? "",
    work: "crown" as LabWork,
    teeth: "",
    shade: "",
    sentOn: today,
    dueOn: plus(today, 7),
    notes: "",
  });
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) =>
    setF((v) => ({ ...v, [k]: e.target.value }));
  if (!open)
    return (
      <Button
        variant="outline"
        size="sm"
        className="self-start"
        onClick={() => setOpen(true)}
        data-testid="lab-new-open"
      >
        <Plus />
        {t("sendToLab")}
      </Button>
    );
  return (
    <form
      className="grid gap-2 rounded-lg border p-3 sm:grid-cols-2"
      data-testid="lab-new"
      onSubmit={(e) => {
        e.preventDefault();
        act.run(
          () =>
            createLabCaseAction({
              patientId,
              appointmentId: appointmentId ?? null,
              ...f,
              shade: f.shade || null,
              notes: f.notes || null,
            }),
          () => setOpen(false),
        );
      }}
    >
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("labWork")}
        <Select value={f.work} onChange={set("work")} data-testid="lab-work">
          {(
            ["crown", "bridge", "veneer", "denture", "aligner", "night_guard", "implant_part", "other"] as const
          ).map((w) => (
            <option key={w} value={w}>
              {t(`work.${w}`)}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("labName")}
        <Input
          value={f.labName}
          onChange={set("labName")}
          list="lab-names"
          required
          minLength={2}
          maxLength={80}
          data-testid="lab-name"
        />
        <datalist id="lab-names">
          {labs.map((l) => (
            <option key={l} value={l} />
          ))}
        </datalist>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("teeth")}
        <Input value={f.teeth} onChange={set("teeth")} maxLength={40} dir="ltr" placeholder="46" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("shade")}
        <Input value={f.shade} onChange={set("shade")} maxLength={20} dir="ltr" placeholder="A2" />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("sentOn")}
        <Input type="date" value={f.sentOn} onChange={set("sentOn")} required />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("dueOn")}
        <Input type="date" value={f.dueOn} onChange={set("dueOn")} min={f.sentOn} required />
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("dentist")}
        <Select value={f.practitionerId} onChange={set("practitionerId")}>
          {doctors.map((d) => (
            <option key={d.id} value={d.id}>
              {locale === "en" && d.nameEn ? d.nameEn : d.nameAr}
            </option>
          ))}
        </Select>
      </label>
      <label className="flex flex-col gap-1 text-xs font-medium">
        {t("labNotes")}
        <Input value={f.notes} onChange={set("notes")} maxLength={300} dir="auto" />
      </label>
      <div className="flex gap-2 sm:col-span-2">
        <Button type="submit" variant="outline" loading={act.pending} data-testid="lab-new-submit">
          {!act.pending && <FlaskConical />}
          {t("sendToLab")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {tc("cancel")}
        </Button>
      </div>
      <div className="sm:col-span-2">
        <FormError message={act.error} />
      </div>
    </form>
  );
}
