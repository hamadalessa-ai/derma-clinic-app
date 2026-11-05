import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { BellOff, Flag, MessageCircle, UserPlus } from "lucide-react";
import { riyadhParts } from "@/components/clinic/time";
import type { listConversations } from "@/lib/whatsapp/staff";
import { cn } from "@/lib/utils";

type Item = Awaited<ReturnType<typeof listConversations>>[number];

/** The list of chats (inbox and simulator). `href` builds the link for one chat. */
export async function ConversationList({
  items,
  activeId,
  href,
  locale,
}: {
  items: Item[];
  activeId: string | null;
  href: (id: string) => string;
  locale: "ar" | "en";
}) {
  const t = await getTranslations("whatsapp");
  if (!items.length) {
    return <EmptyState icon={<MessageCircle />} title={t("empty")} />;
  }
  return (
    <ul className="flex flex-col divide-y" data-testid="conversation-list">
      {items.map((c) => {
        const name = c.patient
          ? locale === "en" && c.patient.nameEn
            ? c.patient.nameEn
            : c.patient.nameAr
          : (c.profileName ?? c.phone);
        return (
          <li key={c.id}>
            <Link
              href={href(c.id)}
              className={cn(
                "hover:bg-accent flex flex-col gap-0.5 px-3 py-2.5 text-sm",
                c.id === activeId && "bg-accent",
              )}
              data-testid="conversation"
              data-phone={c.phone}
              data-patient={c.patient?.fileNumber ?? ""}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{name}</span>
                {c.last && (
                  <span className="text-muted-foreground shrink-0 text-xs" dir="ltr">
                    {riyadhParts(c.last.createdAt).day.slice(5)}{" "}
                    {riyadhParts(c.last.createdAt).time}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 text-xs">
                {!c.patient && (
                  <span className="bg-info text-info-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5">
                    <UserPlus className="size-3" />
                    {t("notPatientYet")}
                  </span>
                )}
                {c.concern && (
                  <span className="bg-danger text-danger-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5">
                    <Flag className="size-3" />
                    {t("concern")}
                  </span>
                )}
                {c.needsReply && (
                  <span
                    className="bg-warning text-warning-foreground rounded px-1.5 py-0.5"
                    data-testid="needs-reply"
                  >
                    {t("needsReply")}
                  </span>
                )}
                {c.optedOut && (
                  <span className="bg-muted text-muted-foreground inline-flex items-center gap-1 rounded px-1.5 py-0.5">
                    <BellOff className="size-3" />
                    {t("optedOut")}
                  </span>
                )}
                <span className="text-muted-foreground" dir="ltr">
                  {c.patient?.fileNumber ?? c.phone}
                </span>
              </div>
              {c.last && (
                <div className="text-muted-foreground truncate text-xs" dir="auto">
                  {c.last.direction === "out" ? "↩ " : ""}
                  {c.last.body}
                </div>
              )}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
