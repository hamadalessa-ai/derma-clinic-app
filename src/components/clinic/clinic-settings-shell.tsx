import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { NavSelect } from "./nav-select";

/** Every section of "Clinic settings", in five groups (one place for each thing). */
export const CLINIC_SETTINGS_GROUPS = [
  {
    key: "clinic",
    items: [
      { key: "details", href: "/settings?tab=clinic" },
      { key: "branches", href: "/setup?tab=branches" },
      { key: "departments", href: "/setup?tab=departments" },
      { key: "rooms", href: "/setup?tab=rooms" },
    ],
  },
  {
    key: "services",
    items: [
      { key: "services", href: "/setup?tab=services" },
      { key: "prices", href: "/setup?tab=prices" },
      { key: "packages", href: "/setup?tab=packages" },
      { key: "memberships", href: "/setup?tab=memberships" },
    ],
  },
  {
    key: "team",
    items: [
      { key: "team", href: "/settings?tab=team" },
      { key: "hours", href: "/working-hours" },
    ],
  },
  {
    key: "patients",
    items: [
      { key: "booking", href: "/settings?tab=booking" },
      { key: "consents", href: "/setup?tab=consents" },
      { key: "messages", href: "/settings/whatsapp" },
    ],
  },
  {
    key: "website",
    items: [
      { key: "website", href: "/settings?tab=website" },
      { key: "subscription", href: "/settings?tab=subscription" },
      { key: "demo", href: "/settings?tab=demo", demoOnly: true },
    ],
  },
] as const;

export type ClinicSettingsSection =
  (typeof CLINIC_SETTINGS_GROUPS)[number]["items"][number]["key"];

/**
 * The frame of every "Clinic settings" page (clinic admin): one title, the grouped sections on
 * the side (a short list on phones), the chosen section on the right.
 */
export async function ClinicSettingsShell({
  active,
  isDemo,
  children,
}: {
  active: ClinicSettingsSection;
  isDemo: boolean;
  children: React.ReactNode;
}) {
  const t = await getTranslations("clinicSettings");
  const groups = CLINIC_SETTINGS_GROUPS.map((g) => ({
    key: g.key,
    label: t(`group.${g.key}`),
    items: g.items
      .filter((i) => !("demoOnly" in i) || isDemo)
      .map((i) => ({ key: i.key, href: i.href, label: t(`item.${i.key}`) })),
  }));
  const current = groups.flatMap((g) => g.items).find((i) => i.key === active);

  return (
    <div className="flex flex-col gap-4" data-testid="clinic-settings">
      <PageHeader title={t("title")} />
      <div className="lg:hidden">
        <NavSelect
          label={t("title")}
          value={current?.href ?? ""}
          groups={groups.map((g) => ({ label: g.label, options: g.items }))}
          testId="clinic-settings-select"
        />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[13rem_minmax(0,1fr)]">
        <nav className="hidden flex-col gap-4 lg:flex" aria-label={t("title")}>
          {groups.map((g) => (
            <div key={g.key} className="flex flex-col gap-0.5">
              <span className="text-muted-foreground px-2 pb-1 text-xs font-semibold">
                {g.label}
              </span>
              {g.items.map((i) => (
                <Link
                  key={i.key}
                  href={i.href}
                  aria-current={i.key === active ? "page" : undefined}
                  className={cn(
                    "rounded-lg px-2 py-1.5 text-sm",
                    i.key === active
                      ? "bg-brand-soft text-brand-strong font-medium"
                      : "hover:bg-accent text-foreground",
                  )}
                >
                  {i.label}
                </Link>
              ))}
            </div>
          ))}
        </nav>
        <div className="flex min-w-0 flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
