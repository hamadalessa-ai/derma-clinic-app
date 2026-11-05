import { getTranslations } from "next-intl/server";
import { LinkTabs } from "@/components/ui/tabs";

export const SETTINGS_TABS = ["clinic", "booking", "website", "consents", "messages", "demo"] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

/** The settings sections as tabs (WhatsApp & AI lives on its own page, same tabs on top). */
export async function SettingsTabs({ active, isDemo }: { active: SettingsTab; isDemo: boolean }) {
  const t = await getTranslations("settings");
  const tabs = [
    { key: "clinic", label: t("tabClinic"), href: "/settings?tab=clinic" },
    { key: "booking", label: t("tabBooking"), href: "/settings?tab=booking" },
    { key: "website", label: t("tabWebsite"), href: "/settings?tab=website" },
    { key: "consents", label: t("tabConsents"), href: "/settings?tab=consents" },
    { key: "messages", label: t("tabMessages"), href: "/settings/whatsapp" },
    ...(isDemo ? [{ key: "demo", label: t("tabDemo"), href: "/settings?tab=demo" }] : []),
  ];
  return <LinkTabs tabs={tabs} active={active} />;
}
