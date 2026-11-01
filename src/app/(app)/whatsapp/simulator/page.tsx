import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { Maximize2 } from "lucide-react";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { ConversationList } from "@/components/whatsapp/conversation-list";
import {
  RunScheduledNow,
  SimulateNewNumber,
  SimulatorPhone,
} from "@/components/whatsapp/simulator";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { whatsappMode } from "@/lib/whatsapp/config";
import { getThread, listConversations } from "@/lib/whatsapp/staff";
import { messageView } from "@/lib/whatsapp/view";
import type { Locale } from "@/i18n/config";

const UUID = /^[0-9a-f-]{36}$/i;

/** Demo only: every message the clinic would send by WhatsApp, as the patient sees it. */
export default async function SimulatorPage({
  searchParams,
}: {
  searchParams: Promise<{ c?: string }>;
}) {
  const ctx = await requirePermission("whatsapp:simulator");
  const t = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;
  if (whatsappMode(ctx.tenant) !== "demo") {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title={t("simulatorTitle")} />
        <Notice tone="warning">{t(`modes.${whatsappMode(ctx.tenant)}`)}</Notice>
      </div>
    );
  }
  const activeId = sp.c && UUID.test(sp.c) ? sp.c : null;
  const { items, thread } = await withActor(actorOf(ctx), async (tx) => ({
    items: await listConversations(tx, "all", 150),
    thread: activeId ? await getThread(tx, activeId) : null,
  }));
  const clinicName = pick(locale, ctx.tenant.nameAr, ctx.tenant.nameEn);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("simulatorTitle")} />
      <Notice tone="info" data-testid="demo-label">
        {t("demoLabel")}
      </Notice>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[18rem_minmax(0,24rem)_minmax(0,1fr)]">
        <Card className={thread ? "hidden lg:block" : ""}>
          <CardHeader>
            <CardTitle>{t("simChats")}</CardTitle>
          </CardHeader>
          <CardContent className="max-h-[70dvh] overflow-y-auto p-0">
            <ConversationList
              items={items}
              activeId={activeId}
              href={(id) => `/whatsapp/simulator?c=${id}`}
              locale={locale}
            />
          </CardContent>
        </Card>
        <div className="flex flex-col gap-2">
          {thread ? (
            <>
              <SimulatorPhone
                conversationId={thread.conversation.id}
                phone={thread.conversation.phone}
                clinicName={clinicName}
                messages={thread.messages.map((m) => messageView(m, locale))}
                backHref="/whatsapp/simulator"
              />
              <div className="flex flex-wrap gap-3 text-sm">
                <Link
                  href={`/simulator/${thread.conversation.id}`}
                  className="text-brand inline-flex items-center gap-1 font-medium underline"
                  data-testid="patient-view-link"
                >
                  <Maximize2 className="size-4" />
                  {t("patientView")}
                </Link>
                <Link
                  href={`/whatsapp?c=${thread.conversation.id}&f=all`}
                  className="text-brand underline"
                >
                  {t("staffView")}
                </Link>
              </div>
            </>
          ) : (
            <p className="text-muted-foreground py-10 text-center text-sm">{t("pickChat")}</p>
          )}
        </div>
        <div className="flex flex-col gap-4">
          {can(ctx.roles, "whatsapp:manage") && (
            <Card>
              <CardHeader>
                <CardTitle>{t("runNowTitle")}</CardTitle>
              </CardHeader>
              <CardContent>
                <RunScheduledNow />
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle>{t("simNewNumber")}</CardTitle>
            </CardHeader>
            <CardContent>
              <SimulateNewNumber />
            </CardContent>
          </Card>
        </div>
      </div>
      <AutoRefresh versionUrl="/api/whatsapp/version" intervalMs={5000} />
    </div>
  );
}
