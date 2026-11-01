import Link from "next/link";
import { getLocale, getTranslations } from "next-intl/server";
import { ArrowLeft, ArrowRight, BellOff, Flag, UserPlus } from "lucide-react";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { LinkTabs } from "@/components/ui/tabs";
import { ChatThread } from "@/components/whatsapp/chat";
import { ConversationList } from "@/components/whatsapp/conversation-list";
import { LinkOrCreatePatient, MarkHandled, ReplyBox } from "@/components/whatsapp/inbox-actions";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { formatTime } from "@/lib/format";
import { whatsappMode } from "@/lib/whatsapp/config";
import { getThread, listConversations, type InboxFilter } from "@/lib/whatsapp/staff";
import { messageView } from "@/lib/whatsapp/view";
import type { Locale } from "@/i18n/config";

const FILTERS: InboxFilter[] = ["needs_reply", "new_contacts", "all"];
const UUID = /^[0-9a-f-]{36}$/i;

/** Reception's WhatsApp inbox: chats that need a reply, new numbers, everything. */
export default async function WhatsAppInboxPage({
  searchParams,
}: {
  searchParams: Promise<{ f?: string; c?: string }>;
}) {
  const ctx = await requirePermission("whatsapp:inbox");
  const t = await getTranslations("whatsapp");
  const locale = (await getLocale()) as Locale;
  const sp = await searchParams;
  const filter: InboxFilter = FILTERS.includes(sp.f as InboxFilter)
    ? (sp.f as InboxFilter)
    : "needs_reply";
  const activeId = sp.c && UUID.test(sp.c) ? sp.c : null;
  const { items, thread } = await withActor(actorOf(ctx), async (tx) => ({
    items: await listConversations(tx, filter),
    thread: activeId ? await getThread(tx, activeId) : null,
  }));
  const mode = whatsappMode(ctx.tenant);
  const label = {
    needs_reply: t("filterNeedsReply"),
    new_contacts: t("filterNewContacts"),
    all: t("filterAll"),
  };
  const windowEnds = thread?.conversation.lastInboundAt
    ? formatTime(new Date(thread.conversation.lastInboundAt.getTime() + 24 * 3600_000), locale)
    : null;
  const p = thread?.patient;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("inboxTitle")} />
      {mode === "demo" && <Notice tone="info">{t("demoLabel")}</Notice>}
      {mode === "off" && <Notice tone="warning">{t("modes.off")}</Notice>}
      <LinkTabs
        active={filter}
        tabs={FILTERS.map((f) => ({ key: f, label: label[f], href: `/whatsapp?f=${f}` }))}
      />
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-[20rem_minmax(0,1fr)]">
        <Card className={thread ? "hidden lg:block" : ""}>
          <CardContent className="max-h-[75dvh] overflow-y-auto p-0">
            <ConversationList
              items={items}
              activeId={activeId}
              href={(id) => `/whatsapp?f=${filter}&c=${id}`}
              locale={locale}
            />
          </CardContent>
        </Card>
        {thread ? (
          <Card className="min-w-0" data-testid="inbox-thread">
            <CardContent className="flex flex-col gap-3 pt-4">
              <div className="flex flex-wrap items-center gap-2">
                <Link href={`/whatsapp?f=${filter}`} className="lg:hidden" aria-label={t("back")}>
                  <ArrowRight className="size-5 ltr:hidden rtl:block" />
                  <ArrowLeft className="size-5 ltr:block rtl:hidden" />
                </Link>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">
                    {p
                      ? pick(locale, p.fullNameAr, p.fullNameEn)
                      : (thread.conversation.profileName ?? thread.conversation.phone)}
                  </div>
                  <div className="text-muted-foreground text-xs" dir="ltr">
                    {p ? `${p.fileNumber} · ` : ""}
                    {thread.conversation.phone}
                  </div>
                </div>
                {!p && (
                  <span className="bg-info text-info-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs">
                    <UserPlus className="size-3" />
                    {t("notPatientYet")}
                  </span>
                )}
                {thread.messages.some((m) => m.flag === "concern") && (
                  <span className="bg-danger text-danger-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs">
                    <Flag className="size-3" />
                    {t("concern")}
                  </span>
                )}
                {(thread.conversation.optedOutAt || p?.whatsappOptedOutAt) && (
                  <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-2 py-0.5 text-xs">
                    <BellOff className="size-3" />
                    {t("optedOut")}
                  </span>
                )}
                {p && (
                  <Link href={`/patients/${p.id}`} className="text-brand text-sm underline">
                    {t("openProfile")}
                  </Link>
                )}
                {thread.conversation.needsReply && (
                  <MarkHandled conversationId={thread.conversation.id} />
                )}
              </div>
              {!p && thread.conversation.profileName && (
                <p className="text-muted-foreground text-xs">
                  {t("profileName", { name: thread.conversation.profileName })}
                </p>
              )}
              <div className="bg-chat-bg max-h-[55dvh] overflow-y-auto rounded-md">
                <ChatThread
                  messages={thread.messages.map((m) => messageView(m, locale))}
                  perspective="clinic"
                  showKinds
                />
              </div>
              <ReplyBox
                conversationId={thread.conversation.id}
                canReplyFreely={thread.canReplyFreely}
                windowEndsAt={windowEnds}
              />
              {!p && (
                <LinkOrCreatePatient
                  conversationId={thread.conversation.id}
                  suggestedName={thread.conversation.profileName}
                />
              )}
            </CardContent>
          </Card>
        ) : (
          <p className="text-muted-foreground hidden py-10 text-center text-sm lg:block">
            {t("pickChat")}
          </p>
        )}
      </div>
      <AutoRefresh versionUrl="/api/whatsapp/version" intervalMs={8000} />
    </div>
  );
}
