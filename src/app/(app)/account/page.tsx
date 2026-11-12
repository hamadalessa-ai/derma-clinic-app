import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { NotificationPrefsForm, PushDeviceSettings } from "@/components/clinic/push-settings";
import { TwoFactorSettings } from "@/components/clinic/two-factor-settings";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { DOCTOR_TYPES, RECEPTION_TYPES, SHARED_TYPES, type PushType } from "@/lib/push/payload";
import { vapidConfig } from "@/lib/push/notify";
import { countDevices, getPrefs } from "@/lib/push/subscriptions";

/** My account: two-step verification, phone notifications for this device, and which ones I get. */
export default async function AccountPage() {
  const ctx = await requirePermission("account:manage");
  const t = await getTranslations("account");
  const { prefs, devices } = await withActor(actorOf(ctx), async (tx) => ({
    prefs: await getPrefs(tx, ctx.user.id),
    devices: await countDevices(tx, ctx.user.id),
  }));
  const types: PushType[] = [
    ...(ctx.roles.includes("practitioner") ? DOCTOR_TYPES : []),
    ...(ctx.roles.includes("receptionist") ? RECEPTION_TYPES : []),
    ...(ctx.roles.includes("practitioner") || ctx.roles.includes("receptionist")
      ? SHARED_TYPES
      : []),
  ];
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t("title")} />
      <Card data-testid="two-factor-card">
        <CardHeader>
          <CardTitle>{t("twoFactorTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <TwoFactorSettings enabled={ctx.twoFactorEnabled} required={ctx.twoFactorRequired} />
        </CardContent>
      </Card>
      {ctx.memberId && (
        <Card>
          <CardHeader>
            <CardTitle>{t("pushTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <PushDeviceSettings publicKey={vapidConfig()?.publicKey ?? null} devices={devices} />
          </CardContent>
        </Card>
      )}
      {types.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t("prefsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            <NotificationPrefsForm types={types} initial={prefs} />
          </CardContent>
        </Card>
      )}
    </div>
  );
}
