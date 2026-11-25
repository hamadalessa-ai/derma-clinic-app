import { ClinicSetup, type SetupTab } from "@/components/clinic/clinic-setup";
import { ClinicSettingsShell } from "@/components/clinic/clinic-settings-shell";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { loadSetup } from "@/lib/setup/admin";

const TABS = [
  "branches",
  "departments",
  "services",
  "rooms",
  "packages",
  "memberships",
  "prices",
  "consents",
] as const;

/** Clinic settings → its set-up sections (clinic admin): the clinic shapes the platform to itself. */
export default async function SetupPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const ctx = await requirePermission("setup:manage");
  const sp = await searchParams;
  const tab: SetupTab = (TABS as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as SetupTab)
    : "services";
  const data = await withActor(actorOf(ctx), (tx) => loadSetup(tx));

  return (
    <ClinicSettingsShell active={tab} isDemo={ctx.tenant.isDemo}>
      <div className="flex flex-col gap-4" data-testid="clinic-setup">
        <ClinicSetup
          tab={tab}
          data={{
            branches: data.branches,
            departments: data.departments,
            services: data.services,
            rooms: data.rooms,
            devices: data.devices,
            packages: data.packages,
            memberships: data.memberships,
            billingItems: data.billingItems,
            consents: data.consents,
            doctors: data.doctors,
          }}
        />
      </div>
    </ClinicSettingsShell>
  );
}
