import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Notice } from "@/components/ui/notice";
import { VapidKeyGenerator } from "@/components/clinic/vapid-generator";
import { requirePermission } from "@/lib/auth/session";
import { vapidConfig } from "@/lib/push/notify";

/**
 * Creates the push-notification keys IN THE BROWSER (WebCrypto). The private key is never sent
 * to the server or stored anywhere: the owner copies it straight into Vercel's settings.
 */
export default async function PushKeysPage() {
  await requirePermission("platform:keys");
  const t = await getTranslations("pushKeys");
  const configured = vapidConfig();
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t("title")} />
      {configured ? (
        <Notice tone="success" data-testid="vapid-configured">
          {t("configured")}
        </Notice>
      ) : (
        <Notice tone="warning">{t("notConfigured")}</Notice>
      )}
      <Card>
        <CardContent className="flex flex-col gap-3 pt-5 text-sm">
          <p>{t("intro")}</p>
          <VapidKeyGenerator />
        </CardContent>
      </Card>
    </div>
  );
}
