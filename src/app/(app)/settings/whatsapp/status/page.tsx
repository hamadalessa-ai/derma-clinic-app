import { desc, eq } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SendTestMessage } from "@/components/whatsapp/settings-forms";
import { conversations, messages } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { formatDualDate, formatTime } from "@/lib/format";
import { liveConfig, whatsappMode } from "@/lib/whatsapp/config";
import { explainError } from "@/lib/whatsapp/errors";
import type { Locale } from "@/i18n/config";

/** Admin: is WhatsApp working? Mode, sender, webhook, latest messages and failures explained. */
export default async function WhatsAppStatusPage() {
  const ctx = await requirePermission("whatsapp:manage");
  const t = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;
  const mode = whatsappMode(ctx.tenant);
  const live = liveConfig();
  const data = await withActor(actorOf(ctx), async (tx) => {
    const base = tx
      .select({ m: messages, phone: conversations.phone })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId));
    return {
      settings: await getSettings(tx),
      recent: await base.orderBy(desc(messages.createdAt)).limit(15),
      failures: await tx
        .select({ m: messages, phone: conversations.phone })
        .from(messages)
        .innerJoin(conversations, eq(conversations.id, messages.conversationId))
        .where(eq(messages.status, "failed"))
        .orderBy(desc(messages.createdAt))
        .limit(15),
    };
  });
  const when = (d: Date) =>
    `${formatDualDate(d, locale, "medium").split(" · ")[0]} ${formatTime(d, locale)}`;
  const row = (r: (typeof data.recent)[number]) => (
    <li key={r.m.id} className="flex flex-col gap-0.5 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">
          {t.has(`kinds.${r.m.kind}`) ? t(`kinds.${r.m.kind}`) : r.m.kind}
        </span>
        <span className="text-muted-foreground" dir="ltr">
          {r.m.direction === "out" ? "→" : "←"} {r.phone}
        </span>
        <span className="text-muted-foreground text-xs">{t(`status.${r.m.status}`)}</span>
        <span className="text-muted-foreground text-xs">{when(r.m.createdAt)}</span>
      </div>
      {r.m.status === "failed" && (
        <div className="text-destructive text-xs">
          #{r.m.errorCode} — {explainError(r.m.errorCode, locale) ?? r.m.errorText}
        </div>
      )}
    </li>
  );
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("statusTitle")} />
      <Card data-testid="whatsapp-status">
        <CardContent className="pt-5">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t("mode")}</dt>
            <dd data-testid="whatsapp-mode" data-mode={mode}>
              {t(`modes.${mode}`)}
            </dd>
            <dt className="text-muted-foreground">{t("provider")}</dt>
            <dd dir="ltr" className="text-start">
              {mode === "demo" ? "demo" : (live.provider ?? "—")}
            </dd>
            <dt className="text-muted-foreground">{t("phoneNumberId")}</dt>
            <dd dir="ltr" className="text-start">
              {live.config?.phoneNumberId ?? "—"}
            </dd>
            <dt className="text-muted-foreground">{t("webhook")}</dt>
            <dd>
              {data.settings.whatsappWebhookVerifiedAt
                ? t("webhookVerified", { date: when(data.settings.whatsappWebhookVerifiedAt) })
                : t("webhookNot")}
            </dd>
          </dl>
          {mode !== "demo" && live.missing.length > 0 && (
            <Notice tone="warning" className="mt-3">
              {t("missing", { names: live.missing.join(", ") })}
            </Notice>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("scheduleTitle")}</CardTitle>
        </CardHeader>
        <CardContent className="text-muted-foreground text-sm">{t("scheduleHint")}</CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("testTitle")}</CardTitle>
        </CardHeader>
        <CardContent>
          <SendTestMessage live={mode === "live"} />
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("failures")}</CardTitle>
        </CardHeader>
        <CardContent>
          {data.failures.length ? (
            <ul className="flex flex-col divide-y">{data.failures.map(row)}</ul>
          ) : (
            <p className="text-muted-foreground text-sm">{t("noFailures")}</p>
          )}
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle>{t("recent")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="flex flex-col divide-y">{data.recent.map(row)}</ul>
        </CardContent>
      </Card>
    </div>
  );
}
