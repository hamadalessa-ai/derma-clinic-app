"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import { saveSiteAction } from "@/app/actions/clinic";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { SiteContent } from "@/db/schema";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Review = { quote: string; name: string; treatment?: string };
const TEXTS = ["headline", "tagline", "about"] as const;
const CONTACTS = ["phone", "whatsapp", "instagram", "x", "tiktok", "licence"] as const;

/** Settings → Website: texts (Arabic + English), contacts and real reviews for the clinic website. */
export function SiteSettingsForm({ initial }: { initial: SiteContent }) {
  const t = useTranslations("settings");
  const [v, setV] = useState<SiteContent>(initial);
  const [reviews, setReviews] = useState<Review[]>(initial.reviews ?? []);
  const [creds, setCreds] = useState<{ ar: string; en: string }[]>(initial.credentials ?? []);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const set = (k: keyof SiteContent, x: string) => setV({ ...v, [k]: x });
  const str = (k: keyof SiteContent) => (v[k] as string | undefined) ?? "";

  return (
    <form
      className="flex flex-col gap-6"
      onSubmit={(e) => {
        e.preventDefault();
        setMsg(null);
        const clean = (x?: string) => (x?.trim() ? x.trim() : undefined);
        run(
          () =>
            saveSiteAction({
              // Content not edited on this form is kept as it is.
              ...initial,
              headlineAr: clean(v.headlineAr),
              headlineEn: clean(v.headlineEn),
              taglineAr: clean(v.taglineAr),
              taglineEn: clean(v.taglineEn),
              aboutAr: clean(v.aboutAr),
              aboutEn: clean(v.aboutEn),
              since: v.since ? Number(v.since) : undefined,
              phone: clean(v.phone),
              whatsapp: clean(v.whatsapp),
              instagram: clean(v.instagram),
              licence: clean(v.licence),
              x: clean(v.x),
              tiktok: clean(v.tiktok),
              credentials: creds
                .filter((c) => c.ar.trim() && c.en.trim())
                .map((c) => ({ ar: c.ar.trim(), en: c.en.trim() })),
              // Specialties are kept as they are (edited with the clinic's content later).
              specialties: initial.specialties,
              departments: initial.departments,
              images: initial.images,
              eyebrowAr: clean(initial.eyebrowAr),
              eyebrowEn: clean(initial.eyebrowEn),
              footerAr: clean(initial.footerAr),
              footerEn: clean(initial.footerEn),
              reviews: reviews
                .filter((r) => r.quote.trim() && r.name.trim())
                .map((r) => ({ quote: r.quote, name: r.name, treatment: clean(r.treatment) })),
            }),
          () => setMsg(t("savedOk")),
        );
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-muted-foreground text-sm">{t("siteIntro")}</p>
        <a
          href="/?preview"
          target="_blank"
          className={buttonVariants({ variant: "outline", size: "sm" })}
          data-testid="site-preview"
        >
          <ExternalLink />
          {t("sitePreview")}
        </a>
      </div>

      {TEXTS.map((k) => (
        <fieldset key={k} className="grid gap-3 sm:grid-cols-2">
          <legend className="mb-1 text-sm font-semibold">{t(`site_${k}`)}</legend>
          {(["Ar", "En"] as const).map((lang) => {
            const key = `${k}${lang}` as keyof SiteContent;
            const field = {
              id: `site-${key}`,
              dir: lang === "Ar" ? "rtl" : "ltr",
              value: str(key),
              maxLength: k === "about" ? 1000 : k === "tagline" ? 300 : 120,
            };
            return (
              <div key={lang} className="flex flex-col gap-1">
                <Label htmlFor={field.id} className="text-muted-foreground text-xs">
                  {lang === "Ar" ? t("siteArabic") : t("siteEnglish")}
                </Label>
                {k === "about" ? (
                  <Textarea {...field} onChange={(e) => set(key, e.target.value)} />
                ) : (
                  <Input {...field} onChange={(e) => set(key, e.target.value)} />
                )}
              </div>
            );
          })}
        </fieldset>
      ))}

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="flex flex-col gap-1">
          <Label htmlFor="site-since">{t("site_since")}</Label>
          <Input
            id="site-since"
            type="number"
            min={1900}
            max={2100}
            dir="ltr"
            value={v.since ?? ""}
            onChange={(e) =>
              setV({ ...v, since: e.target.value ? Number(e.target.value) : undefined })
            }
          />
        </div>
        {CONTACTS.map((k) => (
          <div key={k} className="flex flex-col gap-1">
            <Label htmlFor={`site-${k}`}>{t(`site_${k}`)}</Label>
            <Input
              id={`site-${k}`}
              dir="ltr"
              inputMode={k === "phone" || k === "whatsapp" ? "tel" : undefined}
              placeholder={
                k === "licence" ? "" : k === "phone" || k === "whatsapp" ? "+9665…" : "@clinic"
              }
              value={str(k)}
              onChange={(e) => set(k, e.target.value)}
            />
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-semibold">{t("siteCredentials")}</div>
          <p className="text-muted-foreground text-sm">{t("siteCredentialsHint")}</p>
        </div>
        {creds.map((c, i) => (
          <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
            <Input
              dir="rtl"
              aria-label={t("siteCredentialAr")}
              placeholder={t("siteCredentialAr")}
              maxLength={120}
              value={c.ar}
              onChange={(e) =>
                setCreds(creds.map((x, j) => (j === i ? { ...x, ar: e.target.value } : x)))
              }
            />
            <Input
              dir="ltr"
              aria-label={t("siteCredentialEn")}
              placeholder={t("siteCredentialEn")}
              maxLength={120}
              value={c.en}
              onChange={(e) =>
                setCreds(creds.map((x, j) => (j === i ? { ...x, en: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("siteRemove")}
              onClick={() => setCreds(creds.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
          </div>
        ))}
        {creds.length < 8 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setCreds([...creds, { ar: "", en: "" }])}
          >
            <Plus />
            {t("siteCredentialAdd")}
          </Button>
        )}
      </div>

      <div className="flex flex-col gap-3">
        <div>
          <div className="text-sm font-semibold">{t("siteReviews")}</div>
          <p className="text-muted-foreground text-sm">{t("siteReviewsHint")}</p>
        </div>
        {reviews.map((r, i) => (
          <div key={i} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[1fr_12rem_auto]">
            <Textarea
              aria-label={t("siteReviewQuote")}
              placeholder={t("siteReviewQuote")}
              className="min-h-16 sm:row-span-2"
              maxLength={400}
              value={r.quote}
              onChange={(e) =>
                setReviews(reviews.map((x, j) => (j === i ? { ...x, quote: e.target.value } : x)))
              }
            />
            <Input
              aria-label={t("siteReviewName")}
              placeholder={t("siteReviewName")}
              maxLength={60}
              value={r.name}
              onChange={(e) =>
                setReviews(reviews.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
              }
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("siteRemove")}
              onClick={() => setReviews(reviews.filter((_, j) => j !== i))}
            >
              <Trash2 />
            </Button>
            <Input
              aria-label={t("siteReviewTreatment")}
              placeholder={t("siteReviewTreatment")}
              maxLength={60}
              value={r.treatment ?? ""}
              onChange={(e) =>
                setReviews(
                  reviews.map((x, j) => (j === i ? { ...x, treatment: e.target.value } : x)),
                )
              }
            />
          </div>
        ))}
        {reviews.length < 6 && (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => setReviews([...reviews, { quote: "", name: "" }])}
          >
            <Plus />
            {t("siteReviewAdd")}
          </Button>
        )}
      </div>

      <FormError message={error} />
      <FormSuccess message={msg} />
      <Button type="submit" className="self-start" loading={pending} data-testid="save-site">
        {t("save")}
      </Button>
    </form>
  );
}
