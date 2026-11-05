import { redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { LanguageToggle } from "@/components/language-toggle";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DemoBanner } from "@/components/shell/demo-banner";
import { getStaffContext } from "@/lib/auth/session";
import { getCurrentTenant } from "@/lib/tenant/current";
import { brandStyle, pick } from "@/lib/brand";
import type { Locale } from "@/i18n/config";
import { LoginForm } from "./login-form";

const DEMO_ACCOUNTS: Record<string, { role: string; email: string }[]> = {
  derma: [
    { role: "clinic_admin", email: "admin@derma.demo" },
    { role: "practitioner", email: "dr.sara@derma.demo" },
    { role: "receptionist", email: "reception.riyadh1@derma.demo" },
    { role: "platform_owner", email: "owner@platform.demo" },
  ],
  lamsa: [
    { role: "clinic_admin", email: "admin@lamsa.demo" },
    { role: "practitioner", email: "dr.mona@lamsa.demo" },
    { role: "receptionist", email: "reception@lamsa.demo" },
  ],
};

export default async function LoginPage() {
  const tenant = await getCurrentTenant();
  if (!tenant) redirect("/clinic-not-found");
  if (await getStaffContext()) redirect("/");

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("login");
  const tRoles = await getTranslations("roles");
  const accounts = tenant.isDemo ? (DEMO_ACCOUNTS[tenant.slug] ?? []) : [];

  return (
    <div style={brandStyle(tenant.brandColor)} className="flex min-h-screen flex-col">
      <DemoBanner />
      <div className="flex justify-end p-4">
        <LanguageToggle />
      </div>
      <main className="flex flex-1 items-start justify-center px-4 pb-10 sm:items-center">
        <Card className="w-full max-w-sm">
          <CardHeader className="items-center text-center">
            <div className="bg-brand text-brand-foreground mb-2 flex size-12 items-center justify-center rounded-full text-xl font-bold">
              {pick(locale, tenant.nameAr, tenant.nameEn).charAt(0)}
            </div>
            <CardTitle className="text-brand-strong text-xl">
              {pick(locale, tenant.nameAr, tenant.nameEn)}
            </CardTitle>
            <CardDescription>{t("title")}</CardDescription>
          </CardHeader>
          <CardContent>
            <LoginForm />
            {accounts.length > 0 && (
              <div className="bg-muted mt-6 rounded-md p-3 text-xs">
                <p className="mb-2 font-medium">{t("demoAccounts")}</p>
                <ul className="flex flex-col gap-1">
                  {accounts.map((a) => (
                    <li key={a.email} className="flex justify-between gap-2">
                      <span className="text-muted-foreground">{tRoles(a.role)}</span>
                      <span dir="ltr" className="font-mono">
                        {a.email}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      </main>
    </div>
  );
}
