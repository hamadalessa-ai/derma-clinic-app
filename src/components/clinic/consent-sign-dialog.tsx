"use client";

import { useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { signConsentAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError } from "./form-message";
import { SignaturePad, type SignaturePadHandle } from "./signature-pad";
import { useAction } from "./use-action";

export interface ConsentTemplateView {
  id: string;
  code: string;
  version: number;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}

/** The patient reads the consent and signs on the tablet/phone. Saves the official record. */
export function ConsentSignDialog({
  open,
  onClose,
  onSigned,
  template,
  patient,
  appointmentId,
}: {
  open: boolean;
  onClose: () => void;
  onSigned: () => void;
  template: ConsentTemplateView | null;
  patient: { id: string; nameAr: string };
  appointmentId?: string | null;
}) {
  const t = useTranslations("consent");
  const tc = useTranslations("common");
  const locale = useLocale();
  const pad = useRef<SignaturePadHandle>(null);
  const [signer, setSigner] = useState(patient.nameAr);
  const [relation, setRelation] = useState<"self" | "guardian">("self");
  const { run, pending, error, setError } = useAction();
  const errors = useTranslations("errors");

  if (!template) return null;
  const primary =
    locale === "en"
      ? { title: template.titleEn, body: template.bodyEn }
      : { title: template.titleAr, body: template.bodyAr };
  const secondary =
    locale === "en"
      ? { body: template.bodyAr, dir: "rtl" as const }
      : { body: template.bodyEn, dir: "ltr" as const };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={primary.title}
      closeLabel={tc("close")}
      className="w-[min(100vw-1rem,48rem)]"
    >
      <p className="text-muted-foreground text-xs">
        {t("version", { version: template.version })} · {t("readCarefully")}
      </p>
      <div
        className="bg-muted max-h-64 overflow-y-auto rounded-md border p-3 text-sm leading-7 whitespace-pre-line"
        data-testid="consent-text"
      >
        {primary.body}
        <details className="mt-3">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            {t("englishText")}
          </summary>
          <div dir={secondary.dir} className="mt-2 whitespace-pre-line">
            {secondary.body}
          </div>
        </details>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="signer">{t("signerName")}</Label>
          <Input id="signer" value={signer} onChange={(e) => setSigner(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="relation">{t("relation")}</Label>
          <Select
            id="relation"
            value={relation}
            onChange={(e) => setRelation(e.target.value as "self" | "guardian")}
          >
            <option value="self">{t("self")}</option>
            <option value="guardian">{t("guardian")}</option>
          </Select>
        </div>
      </div>
      <SignaturePad ref={pad} clearLabel={t("clear")} hint={t("signatureHint")} />
      <FormError message={error} />
      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onClose}>
          {tc("cancel")}
        </Button>
        <Button
          disabled={pending}
          onClick={() => {
            const png = pad.current?.toPng();
            if (!png) {
              setError(errors("bad_signature"));
              return;
            }
            run(
              () =>
                signConsentAction({
                  patientId: patient.id,
                  templateId: template.id,
                  signerName: signer,
                  signerRelation: relation,
                  signatureDataUrl: png,
                  appointmentId: appointmentId ?? null,
                }),
              () => onSigned(),
            );
          }}
        >
          {t("submit")}
        </Button>
      </div>
    </Dialog>
  );
}
