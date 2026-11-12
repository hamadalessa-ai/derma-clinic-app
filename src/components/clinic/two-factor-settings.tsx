"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ShieldCheck } from "lucide-react";
import {
  confirmTwoFactorAction,
  disableTwoFactorAction,
  startTwoFactorSetupAction,
} from "@/app/actions/security";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Setup = { qr: string; key: string; backupCodes: string[] };

/** My account → two-step verification: set up with an authenticator app, or switch off. */
export function TwoFactorSettings({ enabled, required }: { enabled: boolean; required: boolean }) {
  const t = useTranslations("twoFactor");
  const act = useAction();
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [setup, setSetup] = useState<Setup | null>(null);
  const [done, setDone] = useState<string | null>(null);

  if (enabled) {
    return (
      <div className="flex flex-col gap-3 text-sm" data-testid="two-factor-on">
        <p className="flex items-center gap-2 font-semibold">
          <ShieldCheck className="text-brand-strong size-5" aria-hidden />
          {t("on")}
        </p>
        <FormSuccess message={done} inline />
        {!required && (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.run(() => disableTwoFactorAction({ password }), () => setPassword(""));
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="tf-off-password">{t("password")}</Label>
              <Input
                id="tf-off-password"
                type="password"
                autoComplete="current-password"
                dir="ltr"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-56"
              />
            </div>
            <Button type="submit" variant="outline" loading={act.pending} disabled={!password}>
              {t("turnOff")}
            </Button>
          </form>
        )}
        <FormError message={act.error} />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 text-sm" data-testid="two-factor-setup">
      {required && <Notice tone="warning">{t("requiredNotice")}</Notice>}
      <p className="text-muted-foreground">{t("explain")}</p>
      {!setup ? (
        <form
          className="flex flex-wrap items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            act.run(
              () => startTwoFactorSetupAction({ password }),
              (d) => {
                setSetup(d);
                setPassword("");
              },
            );
          }}
        >
          <div className="flex flex-col gap-1">
            <Label htmlFor="tf-password">{t("password")}</Label>
            <Input
              id="tf-password"
              type="password"
              autoComplete="current-password"
              dir="ltr"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-56"
            />
          </div>
          <Button type="submit" loading={act.pending} disabled={!password}>
            {t("start")}
          </Button>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          <ol className="flex list-decimal flex-col gap-1 ps-5">
            <li>{t("step1")}</li>
            <li>{t("step2")}</li>
            <li>{t("step3")}</li>
          </ol>
          <div className="flex flex-wrap items-start gap-4">
            {/* eslint-disable-next-line @next/next/no-img-element -- a data: URL drawn on our server */}
            <img
              src={setup.qr}
              alt={t("qrAlt")}
              width={180}
              height={180}
              className="rounded-lg border"
            />
            <div className="flex flex-col gap-1">
              <span className="text-muted-foreground text-xs">{t("manualKey")}</span>
              <code dir="ltr" className="bg-muted rounded-lg p-2 font-mono text-xs break-all" data-testid="two-factor-key">
                {setup.key}
              </code>
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="font-semibold">{t("backupTitle")}</span>
            <span className="text-muted-foreground text-xs">{t("backupHint")}</span>
            <code dir="ltr" className="bg-muted grid grid-cols-2 gap-1 rounded-lg p-3 font-mono text-xs">
              {setup.backupCodes.map((c) => (
                <span key={c}>{c}</span>
              ))}
            </code>
          </div>
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              act.run(
                () => confirmTwoFactorAction({ code }),
                () => {
                  setSetup(null);
                  setCode("");
                  setDone(t("turnedOn"));
                },
              );
            }}
          >
            <div className="flex flex-col gap-1">
              <Label htmlFor="tf-code">{t("code")}</Label>
              <Input
                id="tf-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                dir="ltr"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))}
                className="w-36 tracking-widest"
                data-testid="two-factor-code"
              />
            </div>
            <Button type="submit" loading={act.pending} disabled={code.length !== 6}>
              {t("confirm")}
            </Button>
          </form>
        </div>
      )}
      <FormError message={act.error} />
    </div>
  );
}
