import { getLocale, getTranslations } from "next-intl/server";
import { LogOut } from "lucide-react";
import { signOut } from "@/app/actions/auth";
import { LanguageToggle } from "@/components/language-toggle";
import { BranchSwitcher } from "@/components/shell/branch-switcher";
import { DemoBanner } from "@/components/shell/demo-banner";
import { NavLinks } from "@/components/shell/nav-links";
import { Button } from "@/components/ui/button";
import { can, NAV_ITEMS } from "@/lib/auth/permissions";
import { requireStaff } from "@/lib/auth/session";
import { brandStyle, pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const ctx = await requireStaff();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("nav");
  const tRoles = await getTranslations("roles");

  const items = NAV_ITEMS.filter((i) => can(ctx.role, i.permission)).map((i) => ({
    href: i.href,
    key: i.key,
    label: t(i.key),
  }));
  const branches = ctx.branches.map((b) => ({ id: b.id, name: pick(locale, b.nameAr, b.nameEn) }));
  const clinicName = pick(locale, ctx.tenant.nameAr, ctx.tenant.nameEn);

  return (
    <div style={brandStyle(ctx.tenant.brandColor)} className="flex min-h-screen flex-col">
      <DemoBanner />
      <header className="bg-card sticky top-0 z-10 border-b">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <div className="bg-brand flex size-9 items-center justify-center rounded-full font-bold text-white">
              {clinicName.charAt(0)}
            </div>
            <div className="leading-tight">
              <div className="text-brand font-semibold">{clinicName}</div>
              <div className="text-muted-foreground text-xs">
                {pick(locale, ctx.user.name, ctx.user.nameEn)} · {tRoles(ctx.role)}
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
        <div className="md:hidden">
          <NavLinks items={items} orientation="horizontal" />
        </div>
      </header>
      <div className="flex flex-1">
        <aside className="bg-card hidden w-60 shrink-0 border-e p-3 md:block">
          <NavLinks items={items} orientation="vertical" />
        </aside>
        <main className="min-w-0 flex-1 p-4 md:p-6">{children}</main>
      </div>
    </div>
  );
}
