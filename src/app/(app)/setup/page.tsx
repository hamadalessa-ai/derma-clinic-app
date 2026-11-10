import { getTranslations } from "next-intl/server";
import { ClinicSetup, type SetupTab } from "@/components/clinic/clinic-setup";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { loadSetup } from "@/lib/setup/admin";

const TABS = ["branches", "departments", "services", "rooms", "packages", "consents"] as const;

/** Clinic set-up (clinic admin): the clinic shapes the standard platform to itself. */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("setup:manage");
  const t = await getTranslations("setup");
  const sp = await searchParams;
  const tab: SetupTab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as SetupTab)
    : "services";
  const data = await withActor(actorOf(ctx), (tx) => loadSetup(tx));

  return (
    <div className="flex flex-col gap-4" data-testid="clinic-setup">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      <LinkTabs
        active={tab}
        tabs={TABS.map((k) => ({ key: k, label: t(`tab.${k}`), href: `/setup?tab=${k}` }))}
      />
      <ClinicSetup
        tab={tab}
        data={{
          branches: data.branches,
          departments: data.departments,
          services: data.services,
          rooms: data.rooms,
          devices: data.devices,
          packages: data.packages,
          consents: data.consents,
          doctors: data.doctors,
        }}
      />
    </div>
  );
}
