"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Building2, Check, Copy } from "lucide-react";
import { createClinicAction } from "@/app/actions/clinic";
import { THEME } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

type Done = { name: string; address: string | null; inviteUrl: string | null; existing: boolean };

const EMPTY = {
  nameAr: "",
  nameEn: "",
  slug: "",
  brandColor: THEME.brand as string,
  branchNameAr: "",
  branchNameEn: "",
  cityAr: "",
  cityEn: "",
  departmentAr: "الجلدية",
  departmentEn: "Dermatology",
  adminNameAr: "",
  adminNameEn: "",
  adminEmail: "",
};

/** Platform → Add a clinic: the clinic, its first branch and first admin (who gets an invitation). */
export function NewClinicForm() {
  const t = useTranslations("newClinic");
  const { run, pending, error } = useAction();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(EMPTY);
  const [isDemo, setIsDemo] = useState(true);
  const [done, setDone] = useState<Done | null>(null);
  const set = (k: keyof typeof EMPTY, x: string) => setV({ ...v, [k]: x });

  if (done) return <Created done={done} onClose={() => setDone(null)} />;
  if (!open)
    return (
      <Button className="self-start" onClick={() => setOpen(true)} data-testid="clinic-add">
        <Building2 />
        {t("add")}
      </Button>
    );

  const field = (
    k: keyof typeof EMPTY,
    dir: "rtl" | "ltr",
    opts: { type?: string; required?: boolean; hint?: string } = {},
  ) => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`nc-${k}`}>{t(k)}</Label>
      <Input
        id={`nc-${k}`}
        dir={dir}
        type={opts.type ?? "text"}
        required={opts.required ?? true}
        value={v[k]}
        onChange={(e) => set(k, e.target.value)}
      />
      {opts.hint && <p className="text-muted-foreground text-xs">{opts.hint}</p>}
    </div>
  );

  return (
    <form
      className="shadow-card flex flex-col gap-5 rounded-xl border p-4"
      data-testid="clinic-add-form"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () => createClinicAction({ ...v, adminNameEn: v.adminNameEn || null, isDemo }),
          (r) => {
            setDone({
              name: v.nameAr,
              address: r.address,
              inviteUrl: r.inviteUrl,
              existing: r.existingUser,
            });
            setV(EMPTY);
            setOpen(false);
          },
        );
      }}
    >
      <Section title={t("clinicSection")}>
        {field("nameAr", "rtl")}
        {field("nameEn", "ltr")}
        <div className="flex flex-col gap-1">
          <Label htmlFor="nc-slug">{t("slug")}</Label>
          <Input
            id="nc-slug"
            dir="ltr"
            required
            pattern="[a-z][a-z0-9\-]{0,28}[a-z0-9]"
            value={v.slug}
            onChange={(e) => set("slug", e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
          />
          <p className="text-muted-foreground text-xs">{t("slugHint")}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="nc-brandColor">{t("brandColor")}</Label>
          <div className="flex items-center gap-2">
            <input
              type="color"
              aria-label={t("brandColor")}
              className="h-10 w-12 shrink-0 cursor-pointer rounded-lg border"
              value={v.brandColor}
              onChange={(e) => set("brandColor", e.target.value)}
            />
            <Input
              id="nc-brandColor"
              dir="ltr"
              required
              pattern="#[0-9a-fA-F]{6}"
              value={v.brandColor}
              onChange={(e) => set("brandColor", e.target.value)}
            />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            className="accent-brand size-4"
            checked={isDemo}
            onChange={(e) => setIsDemo(e.target.checked)}
          />
          {t("isDemo")}
        </label>
      </Section>

      <Section title={t("branchSection")}>
        {field("branchNameAr", "rtl")}
        {field("branchNameEn", "ltr")}
        {field("cityAr", "rtl")}
        {field("cityEn", "ltr")}
        {field("departmentAr", "rtl")}
        {field("departmentEn", "ltr")}
      </Section>

      <Section title={t("adminSection")}>
        {field("adminNameAr", "rtl")}
        {field("adminNameEn", "ltr", { required: false })}
        {field("adminEmail", "ltr", { type: "email", hint: t("adminHint") })}
      </Section>

      <FormError message={error} />
      <div className="flex gap-2">
        <Button type="submit" loading={pending} data-testid="clinic-add-save">
          {t("save")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="flex flex-col gap-3">
      <legend className="mb-2 text-sm font-semibold">{title}</legend>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </fieldset>
  );
}

function Created({ done, onClose }: { done: Done; onClose: () => void }) {
  const t = useTranslations("newClinic");
  const [copied, setCopied] = useState(false);
  return (
    <div className="bg-gold flex flex-col gap-3 rounded-xl p-4" data-testid="clinic-created">
      <div className="font-semibold">{t("createdTitle", { name: done.name })}</div>
      {done.address ? (
        <p className="text-sm">
          {t("createdAddress")}{" "}
          <a href={done.address} className="font-medium underline" dir="ltr">
            {done.address}
          </a>
        </p>
      ) : (
        <p className="text-sm">{t("noDomain")}</p>
      )}
      {done.inviteUrl && (
        <>
          <p className="text-sm">{t("inviteText")}</p>
          <Input readOnly value={done.inviteUrl} dir="ltr" onFocus={(e) => e.target.select()} />
          <Button
            size="sm"
            className="self-start"
            onClick={() =>
              navigator.clipboard?.writeText(done.inviteUrl!).then(() => setCopied(true))
            }
          >
            {copied ? <Check /> : <Copy />}
            {copied ? t("copied") : t("copy")}
          </Button>
        </>
      )}
      {done.existing && <p className="text-sm">{t("existingUser")}</p>}
      <p className="text-sm">{t("nextSteps")}</p>
      <Button size="sm" variant="ghost" className="self-start" onClick={onClose}>
        {t("close")}
      </Button>
    </div>
  );
}
