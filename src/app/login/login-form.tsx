"use client";

import { useState, useTransition } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useTranslations } from "next-intl";
import { z } from "zod";
import { signIn, verifySignInCode } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function LoginForm() {
  const t = useTranslations("login");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  // Second step (two-step verification on): the code from the authenticator app.
  const [step, setStep] = useState<"password" | "code">("password");
  const [code, setCode] = useState("");
  const [remember, setRemember] = useState(false);

  const schema = z.object({
    email: z.email(t("emailInvalid")),
    password: z.string().min(1, t("passwordRequired")),
  });
  const form = useForm<z.infer<typeof schema>>({
    resolver: zodResolver(schema),
    defaultValues: { email: "", password: "" },
  });

  const onSubmit = form.handleSubmit((values) => {
    setError(null);
    startTransition(async () => {
      const res = await signIn(values);
      if (!res) return;
      if ("step" in res) setStep("code");
      else setError(t(res.error === "locked" ? "locked" : "invalid"));
    });
  });

  if (step === "code") {
    return (
      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          setError(null);
          startTransition(async () => {
            const res = await verifySignInCode({ code, remember });
            if (res && "error" in res)
              setError(t(res.error === "locked" ? "locked" : "codeInvalid"));
          });
        }}
      >
        <p className="text-sm">{t("codeHint")}</p>
        <div className="flex flex-col gap-2">
          <Label htmlFor="code">{t("code")}</Label>
          <Input
            id="code"
            dir="ltr"
            inputMode="text"
            autoComplete="one-time-code"
            autoFocus
            value={code}
            onChange={(e) => setCode(e.target.value)}
            className="tracking-widest"
            data-testid="login-code"
          />
          <p className="text-muted-foreground text-xs">{t("backupHint")}</p>
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={remember}
            onChange={(e) => setRemember(e.target.checked)}
          />
          {t("remember")}
        </label>
        {error && (
          <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending || code.trim().length < 6}>
          {pending ? t("submitting") : t("verify")}
        </Button>
      </form>
    );
  }

  const { errors } = form.formState;
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4" noValidate>
      <div className="flex flex-col gap-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          type="email"
          dir="ltr"
          autoComplete="username"
          aria-invalid={!!errors.email}
          {...form.register("email")}
        />
        {errors.email && <p className="text-destructive text-sm">{errors.email.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="password">{t("password")}</Label>
        <Input
          id="password"
          type="password"
          dir="ltr"
          autoComplete="current-password"
          aria-invalid={!!errors.password}
          {...form.register("password")}
        />
        {errors.password && <p className="text-destructive text-sm">{errors.password.message}</p>}
      </div>
      {error && (
        <p role="alert" className="bg-destructive/10 text-destructive rounded-md p-3 text-sm">
          {error}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t("submitting") : t("submit")}
      </Button>
    </form>
  );
}
