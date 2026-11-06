"use client";

import { useState, useTransition } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { setInvitePasswordAction } from "@/app/actions/invite";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "@/components/clinic/form-message";

/** Set your own password (invitation link). At least 10 characters, typed twice. */
export function InviteForm({ token, email }: { token: string; email: string }) {
  const t = useTranslations("invite");
  const te = useTranslations("errors");
  const router = useRouter();
  const [pw, setPw] = useState("");
  const [pw2, setPw2] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="bg-card shadow-soft flex flex-col gap-4 rounded-2xl p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        if (pw.length < 10) return setError(t("tooShort"));
        if (pw !== pw2) return setError(t("mismatch"));
        start(async () => {
          const r = await setInvitePasswordAction({ token, password: pw });
          if (!r.ok) return setError(te.has(r.error) ? te(r.error) : te("unexpected"));
          router.push("/login?invited=1");
        });
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label>{t("email")}</Label>
        <Input value={email} readOnly dir="ltr" />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw">{t("password")}</Label>
        <Input
          id="pw"
          type="password"
          autoComplete="new-password"
          minLength={10}
          required
          value={pw}
          onChange={(e) => setPw(e.target.value)}
        />
        <p className="text-muted-foreground text-xs">{t("hint")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="pw2">{t("password2")}</Label>
        <Input
          id="pw2"
          type="password"
          autoComplete="new-password"
          required
          value={pw2}
          onChange={(e) => setPw2(e.target.value)}
        />
      </div>
      <FormError message={error} />
      <Button type="submit" loading={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
