import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { PublicHeader } from "@/components/public/public-header";
import { SiteLangSwitch } from "@/components/site/site-lang-switch";
import { InviteForm } from "@/components/public/invite-form";
import { Notice } from "@/components/ui/notice";
import { withTenant } from "@/db/tenant";
import { brandStyle, pick } from "@/lib/brand";
import { parseInviteToken } from "@/lib/team/invite";
import { inviteInfo } from "@/lib/team/team";
import { getCurrentTenant } from "@/lib/tenant/current";
import type { Locale } from "@/i18n/config";

export const metadata: Metadata = { title: "Invitation · دعوة", robots: { index: false } };

/** A new staff member's invitation: set your own password, then sign in. */
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  const { token } = await params;
  const userId = parseInviteToken(tenant.id, decodeURIComponent(token));
  const info = userId ? await withTenant(tenant.id, (tx) => inviteInfo(tx, userId)) : null;
  if (!userId) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("invite");
  const clinic = pick(locale, tenant.nameAr, tenant.nameEn);

  return (
    <div style={brandStyle(tenant.brandColor)} className="font-site bg-site-mist flex min-h-screen flex-col">
      <PublicHeader
        clinicName={clinic}
        demoMode={null}
        toggle={<SiteLangSwitch tone="light" className="text-site-slate" />}
      />
      <main className="mx-auto flex w-full max-w-md flex-1 flex-col gap-5 px-4 pt-10 pb-12">
        {!info ? (
          <Notice tone="warning">{t("invalid")}</Notice>
        ) : info.passwordSet ? (
          <>
            <Notice tone="info">{t("alreadySet")}</Notice>
            <Link href="/login" className="text-site-primary font-semibold underline">
              {t("signIn")}
            </Link>
          </>
        ) : (
          <>
            <h1 className="font-display text-site-ink text-3xl font-semibold">
              {t("title", { clinic })}
            </h1>
            <p className="text-site-slate">
              {t("text", { name: pick(locale, info.name, info.nameEn) })}
            </p>
            <InviteForm token={token} email={info.email} />
          </>
        )}
      </main>
    </div>
  );
}
