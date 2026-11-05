"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { CheckCircle2, Video } from "lucide-react";
import { signConsentByLinkAction } from "@/app/actions/patient";
import { FormError } from "@/components/clinic/form-message";
import { SignaturePad, type SignaturePadHandle } from "@/components/clinic/signature-pad";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** The consent text, the signer's name, the signature and "I agree": one screen, then done. */
export function ConsentLinkForm({
  token,
  title,
  body,
  otherBody,
  signer,
  forChild,
  videoPath,
}: {
  token: string;
  title: string;
  body: string;
  otherBody: string;
  signer: string;
  forChild: string | null;
  videoPath: string | null;
}) {
  const t = useTranslations("sign");
  const tc = useTranslations("consent");
  const te = useTranslations("errors");
  const locale = useLocale();
  const pad = useRef<SignaturePadHandle>(null);
  const [name, setName] = useState(signer);
  const [agree, setAgree] = useState(false);
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (done) {
    return (
      <div className="bg-card flex flex-col items-center gap-3 rounded-xl border p-6 text-center" data-testid="sign-done">
        <CheckCircle2 className="text-success-foreground size-10" />
        <p className="text-[17px] font-semibold">{t("done")}</p>
        <p className="text-muted-foreground text-sm">{t("doneHint")}</p>
        {videoPath && (
          <Link href={videoPath} className={buttonVariants({ size: "lg" })}>
            <Video />
            {t("toVideo")}
          </Link>
        )}
      </div>
    );
  }

  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-4" data-testid="sign-form">
      <h2 className="text-[17px] leading-[26px] font-semibold">{title}</h2>
      {forChild && <p className="text-sm">{t("forChild", { name: forChild })}</p>}
      <div className="bg-muted max-h-80 overflow-y-auto rounded-lg p-3 text-sm leading-7 whitespace-pre-line">
        {body}
        <details className="mt-3">
          <summary className="text-muted-foreground cursor-pointer text-xs">
            {locale === "en" ? "النص العربي" : tc("englishText")}
          </summary>
          <div dir={locale === "en" ? "rtl" : "ltr"} className="mt-2 whitespace-pre-line">
            {otherBody}
          </div>
        </details>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="signer">{tc("signerName")}</Label>
        <Input id="signer" value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <SignaturePad ref={pad} clearLabel={tc("clear")} hint={tc("signatureHint")} />
      <label className="flex items-start gap-2 text-sm">
        <input
          type="checkbox"
          className="accent-brand mt-1 size-4"
          checked={agree}
          onChange={(e) => setAgree(e.target.checked)}
          data-testid="sign-agree"
        />
        {t("agree")}
      </label>
      <FormError message={error} />
      <Button
        size="lg"
        disabled={!agree}
        loading={pending}
        data-testid="sign-submit"
        onClick={async () => {
          const png = pad.current?.toPng();
          if (!png) return setError(te("bad_signature"));
          setError(null);
          setPending(true);
          const r = await signConsentByLinkAction({ token, signerName: name, signatureDataUrl: png });
          setPending(false);
          if (!r.ok) return setError(te.has(r.error) ? te(r.error) : te("unexpected"));
          setDone(true);
        }}
      >
        {tc("submit")}
      </Button>
    </div>
  );
}
