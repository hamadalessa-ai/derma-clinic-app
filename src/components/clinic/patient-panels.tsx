"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { Check, FileDown, PenLine, Plus, Printer, Sparkles, Trash2 } from "lucide-react";
import {
  addAddendumAction,
  correctNoteAction,
  addMedicalFlagAction,
  openDraftAction,
  overrideSessionsAction,
  recordPaymentAction,
  removeMedicalFlagAction,
  saveDraftAction,
  sellPackageAction,
  signAndCompleteAction,
  signNoteAction,
} from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { formatDualDate, formatSAR } from "@/lib/format";
import type { Locale } from "@/i18n/config";
import { AiReviewTick } from "./ai-review-tick";
import { AiScribe } from "./ai-scribe";
import { ConsentSignDialog, type ConsentTemplateView } from "./consent-sign-dialog";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

// ─── Medical alerts ─────────────────────────────────────────────────────────

export function AlertsEditor({
  patientId,
  flags,
  canEdit,
}: {
  patientId: string;
  flags: {
    id: string;
    kind: "allergy" | "contraindication" | "medication";
    label: string;
    note: string | null;
  }[];
  canEdit: boolean;
}) {
  const t = useTranslations("patientsX");
  const tc = useTranslations("common");
  const { run, pending, error } = useAction();
  const [kind, setKind] = useState<"allergy" | "contraindication" | "medication">("allergy");
  const [label, setLabel] = useState("");
  return (
    <div className="flex flex-col gap-3">
      {flags.length === 0 && <p className="text-muted-foreground text-sm">{t("noAlerts")}</p>}
      <ul className="flex flex-col gap-2">
        {flags.map((f) => (
          <li
            key={f.id}
            className={
              "flex items-center justify-between gap-2 rounded-md px-3 py-2 text-sm " +
              (f.kind === "medication"
                ? "bg-warning text-warning-foreground"
                : "bg-danger text-danger-foreground")
            }
          >
            <span>
              <span className="font-semibold">{t(f.kind)}:</span> {f.label}
              {f.note && <span className="opacity-80"> — {f.note}</span>}
            </span>
            {canEdit && (
              <Button
                variant="ghost"
                size="sm"
                aria-label={tc("remove")}
                disabled={pending}
                onClick={() => run(() => removeMedicalFlagAction({ patientId, flagId: f.id }))}
              >
                <Trash2 />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {canEdit && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex flex-col gap-1">
            <Label htmlFor="flag-kind">{tc("status")}</Label>
            <Select
              id="flag-kind"
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
              className="w-40"
            >
              <option value="allergy">{t("allergy")}</option>
              <option value="contraindication">{t("contraindication")}</option>
              <option value="medication">{t("medication")}</option>
            </Select>
          </div>
          <div className="flex min-w-48 flex-1 flex-col gap-1">
            <Label htmlFor="flag-label">{t("alertLabel")}</Label>
            <Input id="flag-label" value={label} onChange={(e) => setLabel(e.target.value)} />
          </div>
          <Button
            disabled={pending || label.trim().length < 2}
            onClick={() =>
              run(
                () => addMedicalFlagAction({ patientId, kind, label }),
                () => setLabel(""),
              )
            }
          >
            <Plus />
            {t("addAlert")}
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}

// ─── Packages ───────────────────────────────────────────────────────────────

export interface PackageView {
  id: string;
  nameAr: string;
  nameEn: string;
  sessionsTotal: number;
  sessionsUsed: number;
  priceHalalas: number;
  paidHalalas: number;
  outstandingHalalas: number;
  paymentStatus: "paid" | "partial" | "outstanding";
  expiresAt: string;
  expired: boolean;
  events: {
    id: string;
    kind: "deduction" | "override";
    delta: number;
    reason: string | null;
    createdAt: string;
  }[];
}

export function PackagesPanel({
  patientId,
  packages,
  templates,
  canSell,
  canOverride,
}: {
  patientId: string;
  packages: PackageView[];
  templates: { id: string; nameAr: string; nameEn: string; priceHalalas: number }[];
  canSell: boolean;
  canOverride: boolean;
}) {
  const t = useTranslations("packages");
  const tc = useTranslations("common");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string }) => (locale === "en" ? o.nameEn : o.nameAr);
  const sell = useAction();
  const [templateId, setTemplateId] = useState(templates[0]?.id ?? "");
  const [pay, setPay] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t("notInvoice")}</p>
      {packages.length === 0 && <p className="text-muted-foreground text-sm">{t("none")}</p>}
      {packages.map((p) => (
        <PackageCard
          key={p.id}
          patientId={patientId}
          pkg={p}
          canSell={canSell}
          canOverride={canOverride}
        />
      ))}
      {canSell && templates.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("sell")}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap items-end gap-2">
            <div className="flex min-w-56 flex-1 flex-col gap-1">
              <Label htmlFor="pkg-template">{t("template")}</Label>
              <Select
                id="pkg-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
              >
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {name(tpl)} — {formatSAR(tpl.priceHalalas, locale)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex w-40 flex-col gap-1">
              <Label htmlFor="pkg-pay">{t("initialPayment")}</Label>
              <Input
                id="pkg-pay"
                type="number"
                min={0}
                inputMode="decimal"
                value={pay}
                onChange={(e) => setPay(e.target.value)}
                dir="ltr"
              />
            </div>
            <Button
              disabled={sell.pending || !templateId}
              onClick={() =>
                sell.run(
                  () =>
                    sellPackageAction({
                      patientId,
                      templateId,
                      paySar: pay ? Number(pay) : undefined,
                      method: "card",
                    }),
                  () => {
                    setMsg(t("soldOk"));
                    setPay("");
                  },
                )
              }
            >
              {t("sell")}
            </Button>
            <div className="w-full">
              <FormError message={sell.error} />
              <FormSuccess message={msg} />
            </div>
          </CardContent>
        </Card>
      )}
      <span className="sr-only">{tc("done")}</span>
    </div>
  );
}

function PackageCard({
  patientId,
  pkg,
  canSell,
  canOverride,
}: {
  patientId: string;
  pkg: PackageView;
  canSell: boolean;
  canOverride: boolean;
}) {
  const t = useTranslations("packages");
  const locale = useLocale() as Locale;
  const pay = useAction();
  const adj = useAction();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("card");
  const [reason, setReason] = useState("");
  const remaining = pkg.sessionsTotal - pkg.sessionsUsed;
  return (
    <Card data-testid="package-card">
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle>{locale === "en" ? pkg.nameEn : pkg.nameAr}</CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary" data-testid="package-remaining">
            {t("remaining")}:{" "}
            <span dir="ltr" className="ms-1">
              {remaining}/{pkg.sessionsTotal}
            </span>
          </Badge>
          <Badge variant={pkg.paymentStatus === "paid" ? "default" : "outline"}>
            {t(`status_${pkg.paymentStatus}`)}
          </Badge>
          {pkg.expired && <Badge variant="outline">{t("expired")}</Badge>}
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 text-sm">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div>
            <div className="text-muted-foreground">{t("price")}</div>
            {formatSAR(pkg.priceHalalas, locale)}
          </div>
          <div>
            <div className="text-muted-foreground">{t("paid")}</div>
            {formatSAR(pkg.paidHalalas, locale)}
          </div>
          <div>
            <div className="text-muted-foreground">{t("outstanding")}</div>
            {formatSAR(pkg.outstandingHalalas, locale)}
          </div>
          <div>
            <div className="text-muted-foreground">{t("expires")}</div>
            {formatDualDate(new Date(pkg.expiresAt), locale, "medium").split(" · ")[0]}
          </div>
        </div>
        {pkg.events.length > 0 && (
          <details>
            <summary className="text-muted-foreground cursor-pointer">{t("history")}</summary>
            <ul className="mt-2 flex flex-col gap-1">
              {pkg.events.map((e) => (
                <li key={e.id} className="bg-muted flex justify-between gap-2 rounded px-2 py-1">
                  <span>
                    {e.kind === "deduction" ? t("deduction") : t("overrideEvent")}
                    {e.reason ? ` — ${e.reason}` : ""}
                  </span>
                  <span dir="ltr">
                    {e.delta > 0 ? `-${e.delta}` : `+${-e.delta}`} · {e.createdAt.slice(0, 10)}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        )}
        {canSell && pkg.outstandingHalalas > 0 && (
          <div className="flex flex-wrap items-end gap-2">
            <div className="flex w-36 flex-col gap-1">
              <Label htmlFor={`amt-${pkg.id}`}>{t("amount")}</Label>
              <Input
                id={`amt-${pkg.id}`}
                type="number"
                min={1}
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                dir="ltr"
              />
            </div>
            <div className="flex w-32 flex-col gap-1">
              <Label htmlFor={`m-${pkg.id}`}>{t("method")}</Label>
              <Select id={`m-${pkg.id}`} value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="card">{t("card")}</option>
                <option value="cash">{t("cash")}</option>
                <option value="transfer">{t("transfer")}</option>
              </Select>
            </div>
            <Button
              variant="outline"
              disabled={pay.pending || !amount}
              onClick={() =>
                pay.run(
                  () =>
                    recordPaymentAction({
                      patientId,
                      packageId: pkg.id,
                      sar: Number(amount),
                      method,
                    }),
                  () => setAmount(""),
                )
              }
            >
              {t("recordPayment")}
            </Button>
          </div>
        )}
        <FormError message={pay.error} />
        {canOverride && (
          <div className="flex flex-wrap items-end gap-2 border-t pt-3">
            <div className="flex min-w-48 flex-1 flex-col gap-1">
              <Label htmlFor={`r-${pkg.id}`}>
                {t("override")} — {t("overrideReason")}
              </Label>
              <Input
                id={`r-${pkg.id}`}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
            <Button
              variant="outline"
              disabled={adj.pending}
              onClick={() =>
                adj.run(
                  () => overrideSessionsAction({ patientId, packageId: pkg.id, delta: 1, reason }),
                  () => setReason(""),
                )
              }
            >
              {t("useSession")}
            </Button>
            <Button
              variant="outline"
              disabled={adj.pending}
              onClick={() =>
                adj.run(
                  () => overrideSessionsAction({ patientId, packageId: pkg.id, delta: -1, reason }),
                  () => setReason(""),
                )
              }
            >
              {t("giveBack")}
            </Button>
          </div>
        )}
        <FormError message={adj.error} />
      </CardContent>
    </Card>
  );
}

// ─── Consents ───────────────────────────────────────────────────────────────

export function ConsentsPanel({
  patient,
  signed,
  templates,
  canCollect,
}: {
  patient: { id: string; nameAr: string };
  signed: {
    id: string;
    titleAr: string;
    titleEn: string;
    version: number;
    signedAt: string;
    signerName: string;
    intact: boolean;
  }[];
  templates: ConsentTemplateView[];
  canCollect: boolean;
}) {
  const t = useTranslations("consent");
  const locale = useLocale() as Locale;
  const [chosen, setChosen] = useState(templates[0]?.id ?? "");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const template = templates.find((x) => x.id === chosen) ?? null;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-muted-foreground text-xs">{t("officialRecord")}</p>
      {signed.length === 0 && <p className="text-muted-foreground text-sm">{t("none")}</p>}
      <ul className="flex flex-col gap-2">
        {signed.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-2 rounded-md border px-3 py-2 text-sm"
            data-testid="signed-consent"
          >
            <span>
              <span className="font-medium">{locale === "en" ? c.titleEn : c.titleAr}</span>{" "}
              <span className="text-muted-foreground">
                · {t("version", { version: c.version })} ·{" "}
                {formatDualDate(new Date(c.signedAt), locale, "medium").split(" · ")[0]} ·{" "}
                {c.signerName}
              </span>{" "}
              {!c.intact && <Badge variant="outline">{t("altered")}</Badge>}
            </span>
            <span className="flex gap-1">
              <Link
                href={`/consents/${c.id}/print`}
                target="_blank"
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <Printer />
                {t("print")}
              </Link>
              <a
                href={`/consents/${c.id}/pdf`}
                className={buttonVariants({ variant: "outline", size: "sm" })}
              >
                <FileDown />
                {t("pdf")}
              </a>
            </span>
          </li>
        ))}
      </ul>
      {canCollect && templates.length > 0 && (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex min-w-56 flex-1 flex-col gap-1">
            <Label htmlFor="consent-template">{t("chooseTemplate")}</Label>
            <Select
              id="consent-template"
              value={chosen}
              onChange={(e) => setChosen(e.target.value)}
            >
              {templates.map((x) => (
                <option key={x.id} value={x.id}>
                  {locale === "en" ? x.titleEn : x.titleAr} ({t("version", { version: x.version })})
                </option>
              ))}
            </Select>
          </div>
          <Button onClick={() => setOpen(true)}>{t("signNow")}</Button>
        </div>
      )}
      <FormSuccess message={msg} />
      <ConsentSignDialog
        open={open}
        template={template}
        patient={patient}
        onClose={() => setOpen(false)}
        onSigned={() => {
          setOpen(false);
          setMsg(t("signedOk"));
        }}
      />
    </div>
  );
}

// ─── Clinical notes ─────────────────────────────────────────────────────────

export interface NoteView {
  id: string;
  status: "draft" | "signed";
  body: string;
  authorUserId: string;
  authorName: string;
  createdAt: string;
  signedAt: string | null;
  /** The AI scribe drafted (part of) it. */
  aiDrafted?: boolean;
  /** Typed by a nurse / assistant for the doctor (the doctor stays the author). */
  enteredByName?: string | null;
  appointmentId: string | null;
  addenda: { id: string; body: string; authorName: string; createdAt: string }[];
  /** The author corrected the signed note (the earlier texts are in `versions`). */
  correctedAt?: string | null;
  /** The author may still correct it (within 7 days of signing). */
  canCorrect?: boolean;
  /** Earlier texts, oldest first (version 1 = the original). */
  versions?: { id: string; version: number; body: string; createdAt: string }[];
}

export function NotesPanel({
  patientId,
  notes,
  userId,
  canWrite,
  appointmentId,
  scribe = false,
  visit = false,
  preparingFor = null,
}: {
  patientId: string;
  notes: NoteView[];
  userId: string;
  canWrite: boolean;
  appointmentId: string | null;
  /** The AI scribe is available (clinic setting + key). */
  scribe?: boolean;
  /** On the visit screen: "Sign & complete" signs the note AND completes the visit. */
  visit?: boolean;
  /** A nurse / assistant preparing her doctor's note: she edits, the doctor signs. */
  preparingFor?: { userId: string; name: string } | null;
}) {
  const t = useTranslations("notes");
  const create = useAction();
  const forVisit = appointmentId
    ? notes.find(
        (n) =>
          n.appointmentId === appointmentId && n.authorUserId === (preparingFor?.userId ?? userId),
      )
    : null;
  return (
    <div className="flex flex-col gap-4">
      {canWrite && !forVisit && (
        <Button
          className="self-start"
          disabled={create.pending}
          onClick={() => create.run(() => openDraftAction({ patientId, appointmentId }))}
        >
          <Plus />
          {t("new")}
        </Button>
      )}
      <FormError message={create.error} />
      {notes.length === 0 && <p className="text-muted-foreground text-sm">{t("empty")}</p>}
      {notes.map((n) => (
        <NoteCard
          key={n.id}
          patientId={patientId}
          note={n}
          mine={n.authorUserId === userId}
          preparing={!!preparingFor && n.authorUserId === preparingFor.userId}
          canWrite={canWrite}
          scribe={scribe}
          completes={
            visit && appointmentId && n.appointmentId === appointmentId ? appointmentId : null
          }
        />
      ))}
    </div>
  );
}

function NoteCard({
  patientId,
  note,
  mine,
  preparing = false,
  canWrite,
  scribe,
  completes = null,
}: {
  patientId: string;
  note: NoteView;
  mine: boolean;
  /** Prepared by a nurse / assistant for the doctor: editable, never signed by her. */
  preparing?: boolean;
  canWrite: boolean;
  scribe: boolean;
  /** This visit's appointment: signing also completes it, then back to My Day. */
  completes?: string | null;
}) {
  const router = useRouter();
  const t = useTranslations("notes");
  const ts = useTranslations("scribe");
  const locale = useLocale() as Locale;
  const [body, setBody] = useState(note.body);
  /** The AI scribe wrote into this note (before, or just now): signing needs the review tick. */
  const [aiHere, setAiHere] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const aiUsed = !!note.aiDrafted || aiHere;
  const [addendum, setAddendum] = useState("");
  const [correcting, setCorrecting] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const editable = note.status === "draft" && (mine || preparing) && canWrite;
  return (
    <Card data-testid="note-card" data-status={note.status}>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
        <CardTitle className="text-base">
          {note.authorName} ·{" "}
          {formatDualDate(new Date(note.createdAt), locale, "medium").split(" · ")[0]}
        </CardTitle>
        <div className="flex flex-wrap items-center gap-2">
          {note.aiDrafted && note.status === "draft" && (
            <Badge variant="outline" data-testid="ai-draft-badge">
              <Sparkles className="size-3" />
              {ts("aiDraft")}
            </Badge>
          )}
          {note.correctedAt && (
            <Badge variant="outline" data-testid="note-corrected">
              {t("corrected")}
            </Badge>
          )}
          <Badge variant={note.status === "signed" ? "default" : "outline"}>
            {note.status === "signed" ? t("signed") : t("draft")}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {editable ? (
          <>
            {scribe && (
              <AiScribe
                patientId={patientId}
                noteId={note.id}
                onDrafted={(b) => {
                  setBody(b);
                  setAiHere(true);
                  setReviewed(false);
                }}
              />
            )}
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder={t("placeholder")}
              className="min-h-40"
              aria-label={t("draft")}
            />
            {aiUsed && !(preparing && !mine) && (
              <AiReviewTick checked={reviewed} onChange={setReviewed} />
            )}
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={pending}
                onClick={() =>
                  run(
                    () => saveDraftAction({ patientId, noteId: note.id, body }),
                    () => setMsg(t("savedOk")),
                  )
                }
              >
                {t("saveDraft")}
              </Button>
              {preparing && !mine ? (
                <span
                  className="text-muted-foreground self-center text-xs"
                  data-testid="doctor-signs"
                >
                  {t("doctorSigns", { name: note.authorName })}
                </span>
              ) : (
                <Button
                  disabled={!body.trim() || (aiUsed && !reviewed)}
                  loading={pending}
                  data-testid={completes ? "sign-complete" : "sign-note"}
                  onClick={() => {
                    if (!window.confirm(t(completes ? "signCompleteConfirm" : "signConfirm")))
                      return;
                    if (completes) {
                      run(
                        () =>
                          signAndCompleteAction({
                            appointmentId: completes,
                            noteId: note.id,
                            body,
                            aiReviewed: reviewed,
                          }),
                        (r) => {
                          setMsg(t(r.completed ? "signedCompleted" : "signedOk"));
                          if (r.completed) router.push("/my-day");
                        },
                      );
                    } else {
                      run(
                        () =>
                          signNoteAction({
                            patientId,
                            noteId: note.id,
                            body,
                            aiReviewed: reviewed,
                          }),
                        () => setMsg(t("signedOk")),
                      );
                    }
                  }}
                >
                  {!pending && <Check />}
                  {completes ? t("signComplete") : t("sign")}
                </Button>
              )}
            </div>
          </>
        ) : correcting ? (
          <div className="flex flex-col gap-2" data-testid="note-correct-form">
            <Textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              className="min-h-40"
              aria-label={t("correct")}
            />
            <p className="text-muted-foreground text-xs">{t("correctHint")}</p>
            <div className="flex flex-wrap justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => {
                  setBody(note.body);
                  setCorrecting(false);
                }}
              >
                {t("cancelCorrect")}
              </Button>
              <Button
                loading={pending}
                disabled={!body.trim() || body.trim() === note.body.trim()}
                data-testid="note-correct-save"
                onClick={() =>
                  run(
                    () => correctNoteAction({ patientId, noteId: note.id, body }),
                    () => {
                      setCorrecting(false);
                      setMsg(t("correctedOk"));
                    },
                  )
                }
              >
                {t("saveCorrection")}
              </Button>
            </div>
          </div>
        ) : (
          <p className="text-sm leading-7 whitespace-pre-line">{note.body}</p>
        )}
        {note.canCorrect && !correcting && (
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => {
              setBody(note.body);
              setCorrecting(true);
            }}
            data-testid="note-correct"
          >
            <PenLine />
            {t("correct")}
          </Button>
        )}
        {!!note.versions?.length && (
          <details className="text-sm" data-testid="note-versions">
            <summary className="text-muted-foreground cursor-pointer text-xs font-medium">
              {t("earlierVersions", { count: note.versions.length })}
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              {note.versions.map((v) => (
                <div key={v.id} className="bg-muted rounded-md px-3 py-2">
                  <div className="text-muted-foreground text-xs">
                    {v.version === 1 ? t("original") : t("versionN", { n: v.version })} ·{" "}
                    {t("replacedOn", {
                      date: formatDualDate(new Date(v.createdAt), locale, "medium"),
                    })}
                  </div>
                  <p className="whitespace-pre-line">{v.body}</p>
                </div>
              ))}
            </div>
          </details>
        )}
        {note.enteredByName && (
          <p className="text-muted-foreground text-xs" data-testid="entered-by">
            {t("enteredBy", { name: note.enteredByName })}
          </p>
        )}
        {note.signedAt && (
          <p className="text-muted-foreground text-xs">
            {t("signedAt")}: {formatDualDate(new Date(note.signedAt), locale, "medium")}
          </p>
        )}
        {note.addenda.map((a) => (
          <div key={a.id} className="border-brand bg-muted rounded-md border-s-4 px-3 py-2 text-sm">
            <div className="text-muted-foreground text-xs">
              {t("addendum")} · {a.authorName} · {a.createdAt.slice(0, 10)}
            </div>
            <p className="whitespace-pre-line">{a.body}</p>
          </div>
        ))}
        {note.status === "signed" && canWrite && (
          <div className="flex flex-col gap-2">
            <Textarea
              value={addendum}
              onChange={(e) => setAddendum(e.target.value)}
              className="min-h-16"
              aria-label={t("addAddendum")}
            />
            <Button
              variant="outline"
              className="self-end"
              disabled={pending || !addendum.trim()}
              onClick={() =>
                run(
                  () => addAddendumAction({ patientId, noteId: note.id, body: addendum }),
                  () => (setAddendum(""), setMsg(t("addendumOk"))),
                )
              }
            >
              {t("addAddendum")}
            </Button>
          </div>
        )}
        <FormError message={error} />
        <FormSuccess message={msg} />
      </CardContent>
    </Card>
  );
}
