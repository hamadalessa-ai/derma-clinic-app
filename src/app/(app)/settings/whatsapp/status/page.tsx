import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { getLocale, getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { SendTestMessage } from "@/components/whatsapp/settings-forms";
import { appointments, conversations, messages, pushLog, users } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { formatDualDate, formatTime } from "@/lib/format";
import { clinicLiveConfig, whatsappMode } from "@/lib/whatsapp/config";
import { explainError } from "@/lib/whatsapp/errors";
import { linkContext, rolesOf } from "@/lib/push/notify";
import { pushLink } from "@/lib/push/links";
import { ALL_PUSH_TYPES, type PushType } from "@/lib/push/payload";
import type { Locale } from "@/i18n/config";

/** Admin: is WhatsApp working? Mode, sender, webhook, latest messages and failures explained. */
export default async function WhatsAppStatusPage() {
  const ctx = await requirePermission("whatsapp:manage");
  const t = await getTranslations("whatsapp");
  const tp = await getTranslations("pushLog");
  const ta = await getTranslations("account");
  const locale = (await getLocale()) as Locale;
  const mode = whatsappMode(ctx.tenant);
  const live = clinicLiveConfig(ctx.tenant);
  const data = await withActor(actorOf(ctx), async (tx) => {
    const base = tx
      .select({ m: messages, phone: conversations.phone })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId));
    const pushRows = await tx
      .select({ l: pushLog, name: users.name, nameEn: users.nameEn })
      .from(pushLog)
      .leftJoin(users, eq(users.id, pushLog.userId))
      .orderBy(desc(pushLog.createdAt))
      .limit(30);
    // Where each notification opens for that person (the same rule the sender uses).
    const apptIds = [...new Set(pushRows.flatMap((r) => r.l.appointmentId ?? []))];
    const appts = apptIds.length
      ? await tx
          .select({
            id: appointments.id,
            patientId: appointments.patientId,
            startsAt: appointments.startsAt,
          })
          .from(appointments)
          .where(inArray(appointments.id, apptIds))
      : [];
    const contexts = new Map(
      await Promise.all(appts.map(async (a) => [a.id, await linkContext(tx, a.id, a)] as const)),
    );
    const roles = await rolesOf(tx, [...new Set(pushRows.flatMap((r) => r.l.userId ?? []))]);
    const linkOf = (l: (typeof pushRows)[number]["l"]) => {
      const c = l.appointmentId ? contexts.get(l.appointmentId) : null;
      if (!c || !l.userId || !(ALL_PUSH_TYPES as readonly string[]).includes(l.type)) return null;
      return pushLink(l.type as PushType, roles.get(l.userId) ?? [], c);
    };
    return {
      pushRows: pushRows.map((r) => ({ ...r, link: linkOf(r.l) })),
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
              {mode === "demo" ? "demo" : (live.config?.provider ?? (live.source ? "meta" : "—"))}
            </dd>
            <dt className="text-muted-foreground">{t("clinicNumber")}</dt>
            <dd dir="ltr" className="text-start" data-testid="whatsapp-number">
              {ctx.tenant.whatsappDisplayPhone ?? "—"}
            </dd>
            <dt className="text-muted-foreground">{t("phoneNumberId")}</dt>
            <dd dir="ltr" className="text-start">
              {live.config?.phoneNumberId ?? ctx.tenant.whatsappPhoneNumberId ?? "—"}
            </dd>
            <dt className="text-muted-foreground">{t("webhook")}</dt>
            <dd>
              {data.settings.whatsappWebhookVerifiedAt
                ? t("webhookVerified", { date: when(data.settings.whatsappWebhookVerifiedAt) })
                : t("webhookNot")}
            </dd>
          </dl>
          {mode === "off" && !live.source && (
            <Notice tone="info" className="mt-3">
              {t("connectedByPlatform")}
            </Notice>
          )}
          {mode !== "demo" && live.source && live.missing.length > 0 && (
            <Notice tone="warning" className="mt-3">
              {t("missing", { names: live.missing.join(", ") })}
            </Notice>
          )}
        </CardContent>
      </Card>
      <Card data-testid="push-log">
        <CardHeader>
          <CardTitle>{tp("title")}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          <p className="text-muted-foreground text-sm">{tp("hint")}</p>
          {data.pushRows.length === 0 ? (
            <p className="text-muted-foreground text-sm">{tp("empty")}</p>
          ) : (
            <ul className="flex flex-col divide-y">
              {data.pushRows.map(({ l, name, nameEn, link }) => (
                <li
                  key={l.id}
                  className="flex flex-col gap-0.5 py-2 text-sm"
                  data-testid="push-log-row"
                  data-type={l.type}
                  data-outcome={l.outcome}
                  data-user={l.userId ?? undefined}
                  data-link={link ?? undefined}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">
                      {ta.has(`types.${l.type}`) ? ta(`types.${l.type}`) : tp("test")}
                    </span>
                    <span>→ {name ? (locale === "en" && nameEn ? nameEn : name) : "—"}</span>
                    <span
                      className={
                        l.outcome === "sent"
                          ? "bg-success text-success-foreground rounded px-1.5 text-xs"
                          : "bg-warning text-warning-foreground rounded px-1.5 text-xs"
                      }
                    >
                      {tp(`outcomes.${l.outcome}`)}
                    </span>
                    <span className="text-muted-foreground text-xs">{when(l.createdAt)}</span>
                  </div>
                  {(l.reason || l.statusCode) && (
                    <div className="text-muted-foreground text-xs" dir="auto">
                      {l.statusCode ? `HTTP ${l.statusCode} · ` : ""}
                      {l.reason}
                    </div>
                  )}
                  {link && (
                    <div className="text-muted-foreground text-xs">
                      {tp("opens")}{" "}
                      <Link href={link} className="text-brand-strong underline" dir="ltr">
                        {link.split(/[?#]/)[0]}
                      </Link>
                    </div>
                  )}
                </li>
              ))}
            </ul>
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
