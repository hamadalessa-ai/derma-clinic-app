"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { requestPortalCodeAction, verifyPortalCodeAction } from "@/app/actions/patient";
import { FormError } from "@/components/clinic/form-message";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";

export function PortalSignIn() {
  const t = useTranslations("my");
  const tb = useTranslations("book");
  const te = useTranslations("errors");
  const router = useRouter();
  const [phone, setPhone] = useState("");
  const [website, setWebsite] = useState("");
  const [stage, setStage] = useState<{ demoCode: string | null } | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const err = (c: string) => setError(te.has(c) ? te(c) : te("unexpected"));

  return (
    <div className="bg-card flex flex-col gap-4 rounded-xl border p-5" data-testid="portal-sign-in">
      <div>
        <h1 className="text-xl font-bold">{t("signInTitle")}</h1>
        <p className="text-muted-foreground text-sm">{t("signInHint")}</p>
      </div>
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          start(async () => {
            if (!stage) {
              const r = await requestPortalCodeAction({ phone, website });
              if (!r.ok) return err(r.error);
              setStage(r.data);
            } else {
              const r = await verifyPortalCodeAction({ phone, code });
              if (!r.ok) return err(r.error);
              router.refresh();
            }
          });
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="my-phone">{tb("mobile")}</Label>
          <Input
            id="my-phone"
            required
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            placeholder={tb("mobileHint")}
            value={phone}
            disabled={!!stage}
            onChange={(e) => setPhone(e.target.value)}
          />
        </div>
        <div aria-hidden className="absolute -start-[9999px] h-0 w-0 overflow-hidden">
          <label htmlFor="my-website">{tb("website")}</label>
          <input
            id="my-website"
            tabIndex={-1}
            autoComplete="off"
            value={website}
            onChange={(e) => setWebsite(e.target.value)}
          />
        </div>
        {stage && (
          <div className="flex flex-col gap-1.5">
            <p className="text-sm">{tb("codeSent")}</p>
            {stage.demoCode && (
              <Notice tone="info" data-testid="demo-code">
                {tb("demoCode", { code: stage.demoCode })}
              </Notice>
            )}
            <Label htmlFor="my-code">{tb("code")}</Label>
            <Input
              id="my-code"
              required
              inputMode="numeric"
              autoComplete="one-time-code"
              dir="ltr"
              maxLength={6}
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
          </div>
        )}
        <FormError message={error} />
        <Button type="submit" disabled={pending} data-testid={stage ? "verify" : "send-code"}>
          {stage ? t("verify") : t("sendCode")}
        </Button>
        {stage && (
          <Button
            type="button"
            variant="ghost"
            disabled={pending}
            onClick={() => {
              setStage(null);
              setCode("");
              setError(null);
            }}
          >
            {tb("back")}
          </Button>
        )}
      </form>
      <p className="text-muted-foreground text-xs">{t("sessionNote")}</p>
    </div>
  );
}
