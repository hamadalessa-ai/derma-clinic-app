import { getFormatter, getLocale, getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { BranchSwitcher } from "@/components/shell/branch-switcher";
import { DemoBanner } from "@/components/shell/demo-banner";
import { MobileNav } from "@/components/shell/mobile-nav";
import { NavLinks } from "@/components/shell/nav-links";
import { Button } from "@/components/ui/button";
import { can, NAV_ITEMS } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { brandStyle, pick } from "@/lib/brand";
import { limitWarnings } from "@/lib/platform/overview";
import { activeGrant } from "@/lib/support/grants";
import { withTenant } from "@/db/tenant";
import { whatsappMode } from "@/lib/whatsapp/config";
import type { Locale } from "@/i18n/config";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireStaff();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("roles");
  const tStatus = await getTranslations("clinicStatus");
  // Clinic admins see when this month's AI / WhatsApp use reaches 80 % of the platform's limit.
  const warnings = can(ctx.roles, "settings:manage") ? await limitWarnings(ctx.tenant) : [];
  const tSupport = await getTranslations("support");
  const format = await getFormatter();
  // Clinic admins always see when the platform's support has access to their clinic.
  const clinicGrant =
    !ctx.support && can(ctx.roles, "support:grant")
      ? await withTenant(ctx.tenant.id, (tx) => activeGrant(tx))
      : null;

  const demo = whatsappMode(ctx.tenant) === "demo";
  const items = NAV_ITEMS.filter(
    (i) => can(ctx.roles, i.permission) && (!("demoOnly" in i) || demo),
  ).map((i) => ({
    href: i.href,
    key: i.key,
    label: t(i.key),
  }));
  const branches = ctx.branches.map((b) => ({ id: b.id, name: pick(locale, b.nameAr, b.nameEn) }));
  const clinicName = pick(locale, ctx.tenant.nameAr, ctx.tenant.nameEn);

  return (
    <div style={brandStyle(ctx.tenant.brandColor)} className="flex min-h-screen flex-col">
      <DemoBanner />
      {ctx.tenant.status !== "active" && (
        <div
          className="bg-danger text-danger-foreground px-4 py-1.5 text-center text-xs font-medium"
          data-testid="clinic-status-banner"
        >
          {tStatus(`banner.${ctx.tenant.status}`)}
          {ctx.tenant.statusReason ? ` · ${ctx.tenant.statusReason}` : ""}
        </div>
      )}
      {warnings.map((w) => (
        <div
          key={w.kind}
          className="bg-warning text-warning-foreground px-4 py-1.5 text-center text-xs font-medium"
          data-testid="limit-warning"
        >
          {tStatus(w.used >= w.limit ? `limitReached.${w.kind}` : `limitNear.${w.kind}`, {
            used: w.used,
            limit: w.limit,
          })}
        </div>
      ))}
      {ctx.support && (
        <div
          className="bg-info text-info-foreground px-4 py-1.5 text-center text-xs font-medium"
          data-testid="support-banner"
        >
          {tSupport(ctx.support.allowChanges ? "bannerChanges" : "bannerView", {
            time: format.dateTime(ctx.support.expiresAt, {
              timeStyle: "short",
              dateStyle: "short",
            }),
          })}
        </div>
      )}
      {clinicGrant && (
        <div className="bg-info text-info-foreground px-4 py-1.5 text-center text-xs font-medium">
          {tSupport("bannerClinic", {
            time: format.dateTime(clinicGrant.expiresAt, {
              timeStyle: "short",
              dateStyle: "short",
            }),
          })}
        </div>
      )}
      <header className="bg-card/95 sticky top-0 z-10 border-b backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 md:px-6">
          <div className="flex items-center gap-3">
            <div className="bg-brand text-brand-foreground flex size-9 items-center justify-center rounded-full font-bold">
              {clinicName.charAt(0)}
            </div>
            <div className="leading-tight">
              <div className="text-brand-strong font-semibold">{clinicName}</div>
              <div className="text-muted-foreground text-xs">
                {pick(locale, ctx.user.name, ctx.user.nameEn)} ·{" "}
                {ctx.roles.map((r) => tRoles(r)).join(" + ")}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <BranchSwitcher branches={branches} activeId={ctx.activeBranch?.id ?? null} />
            <LanguageToggle />
            <form action={signOut}>
              <Button variant="ghost" size="sm" type="submit" aria-label={t("logout")}>
                <LogOut className="rtl:rotate-180" />
                <span className="hidden sm:inline">{t("logout")}</span>
              </Button>
            </form>
          </div>
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="bg-card hidden w-60 shrink-0 border-e p-3 md:block">
          <NavLinks items={items} orientation="vertical" />
        </aside>
        {/* Bottom padding on phones so the bottom menu never covers content. */}
        <main className="min-w-0 flex-1 p-4 pb-[calc(5rem+env(safe-area-inset-bottom))] md:p-6 lg:p-8">
          <div className="animate-fade-in mx-auto w-full max-w-7xl">{children}</div>
        </main>
      </div>
      <MobileNav items={items} />
    </div>
  );
}
