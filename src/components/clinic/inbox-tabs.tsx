import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Inbox, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/** The two halves of the inbox, each with how many things wait for an answer. */
export async function InboxTabs({
  active,
  counts,
}: {
  active: "messages" | "requests";
  counts: { messages: number; requests: number };
}) {
  const t = await getTranslations("inbox");
  const tabs = [
    {
      key: "messages" as const,
      href: "/whatsapp",
      label: t("messages"),
      n: counts.messages,
      Icon: MessageCircle,
    },
    {
      key: "requests" as const,
      href: "/requests",
      label: t("requests"),
      n: counts.requests,
      Icon: Inbox,
    },
  ];
  return (
    <nav
      className="bg-muted flex w-full gap-1 rounded-xl p-1 sm:w-auto sm:self-start"
      data-testid="inbox-tabs"
    >
      {tabs.map(({ key, href, label, n, Icon }) => (
        <Link
          key={key}
          href={href}
          aria-current={active === key ? "page" : undefined}
          className={cn(
            "flex flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-medium transition-colors sm:flex-none",
            active === key
              ? "bg-card text-foreground shadow-card"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          <Icon className="size-4" />
          {label}
          {n > 0 && (
            <span className="bg-brand text-brand-foreground min-w-5 rounded-full px-1.5 text-center text-xs leading-5">
              {n}
            </span>
          )}
        </Link>
      ))}
    </nav>
  );
}
