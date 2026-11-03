import Link from "next/link";
import { asc } from "drizzle-orm";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import {
  AiReceptionistSettings,
  ServiceTextsEditor,
  ShowServiceToggle,
  TemplateEditor,
} from "@/components/whatsapp/settings-forms";
import { messageTemplates, services } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { aiRepliesToday } from "@/lib/ai/receptionist";
import { TEMPLATE_KINDS, TEMPLATES } from "@/lib/whatsapp/catalog";

/** Clinic admin: WhatsApp message types (on/off, wording) and per-service texts. */
export default async function WhatsAppSettingsPage() {
  const ctx = await requirePermission("whatsapp:manage");
  const t = await getTranslations("whatsapp");
  const data = await withActor(actorOf(ctx), async (tx) => ({
    settings: await getSettings(tx),
    templates: await tx.select().from(messageTemplates),
    services: await tx.select().from(services).orderBy(asc(services.sortOrder)),
    aiUsedToday: await aiRepliesToday(tx),
  }));
  return (
    <div className="flex max-w-4xl flex-col gap-4">
      <PageHeader title={t("settingsTitle")} />
      <Link href="/settings/whatsapp/status" className="text-brand self-start text-sm underline">
        {t("statusLink")}
      </Link>
      <Card>
        <CardContent className="pt-5">
          <ShowServiceToggle initial={data.settings.showServiceInMessages} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("ai.title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <AiReceptionistSettings
            initialEnabled={data.settings.aiReceptionistEnabled}
            initialLimit={data.settings.aiDailyLimit}
            keySet={!!process.env.ANTHROPIC_API_KEY?.trim()}
            usedToday={data.aiUsedToday}
          />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("templatesTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t("templatesHint")}</p>
          {TEMPLATE_KINDS.map((kind) => {
            const row = data.templates.find((x) => x.kind === kind);
            return (
              <TemplateEditor
                key={kind}
                kind={kind}
                label={t(`kinds.${kind}`)}
                canDisable={TEMPLATES[kind].canDisable}
                variables={TEMPLATES[kind].variables}
                initial={{
                  enabled: row?.enabled ?? true,
                  bodyAr: row?.bodyAr ?? TEMPLATES[kind].bodyAr,
                  bodyEn: row?.bodyEn ?? TEMPLATES[kind].bodyEn,
                }}
              />
            );
          })}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("serviceTextsTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{t("serviceTextsHint")}</p>
          {data.services
            .filter((s) => s.isActive)
            .map((s) => (
              <ServiceTextsEditor
                key={s.id}
                service={{
                  id: s.id,
                  nameAr: s.nameAr,
                  nameEn: s.nameEn,
                  preVisitAr: s.preVisitAr ?? "",
                  preVisitEn: s.preVisitEn ?? "",
                  postCareAr: s.postCareAr ?? "",
                  postCareEn: s.postCareEn ?? "",
                  recallAfterDays: s.recallAfterDays,
                }}
              />
            ))}
        </CardContent>
      </Card>
    </div>
  );
}
