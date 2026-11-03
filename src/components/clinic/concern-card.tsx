import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Flag, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatThread } from "@/components/whatsapp/chat";
import { pick } from "@/lib/brand";
import { formatDualDate } from "@/lib/format";
import type { ChatMessageView } from "@/lib/whatsapp/view";
import type { Concern } from "@/lib/whatsapp/concerns";
import type { Locale } from "@/i18n/config";

/**
 * A patient's post-care concern with the WhatsApp conversation around it. Always read-only here:
 * reception answers in the WhatsApp inbox (the button is shown only to those who may use it).
 */
export async function ConcernCard({
  concern,
  thread,
  locale,
  inboxHref,
  highlighted,
}: {
  concern: Concern;
  thread: ChatMessageView[];
  locale: Locale;
  /** Set only for staff who may open the WhatsApp inbox. */
  inboxHref: string | null;
  highlighted: boolean;
}) {
  const t = await getTranslations("concerns");
  return (
    <Card
      id={highlighted ? "concern" : undefined}
      data-testid="patient-concern"
      data-appointment={concern.appointmentId}
      data-open={concern.open}
      // scroll-mt: the sticky top bar must not cover the card when the link jumps to it.
      className={highlighted ? "ring-destructive scroll-mt-36 ring-2" : undefined}
    >
      <CardHeader>
        <CardTitle className="flex flex-wrap items-center gap-2">
          <Badge variant="destructive" data-testid="concern-badge">
            <Flag className="me-1 size-3" aria-hidden />
            {t("badge")}
          </Badge>
          <span>
            {t("afterVisit", {
              service: pick(locale, concern.serviceNameAr, concern.serviceNameEn),
              date: formatDualDate(concern.visitAt, locale, "medium"),
            })}
          </span>
          <Badge variant={concern.open ? "outline" : "secondary"}>
            {concern.open ? t("open") : t("answered")}
          </Badge>
        </CardTitle>
        <p className="text-muted-foreground text-sm">
          {t("raised", {
            doctor: pick(locale, concern.doctorNameAr, concern.doctorNameEn),
            when: formatDualDate(concern.raisedAt, locale, "medium"),
          })}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <div className="bg-muted max-h-[60dvh] overflow-y-auto rounded-md">
          <ChatThread messages={thread} perspective="clinic" showKinds />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-muted-foreground text-xs" data-testid="concern-read-only">
            {t("readOnly")}
          </p>
          {inboxHref && (
            <Link href={inboxHref} className={buttonVariants({ variant: "outline", size: "sm" })}>
              <MessageCircle />
              {t("openInbox")}
            </Link>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
