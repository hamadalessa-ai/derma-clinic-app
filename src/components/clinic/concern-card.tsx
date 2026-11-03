import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { Flag, MessageCircle } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ChatThread, type ConcernEventView } from "@/components/whatsapp/chat";
import { pick } from "@/lib/brand";
import { formatDualDate } from "@/lib/format";
import type { ChatMessageView } from "@/lib/whatsapp/view";
import type { Concern } from "@/lib/whatsapp/concerns";
import type { Locale } from "@/i18n/config";
import { ConcernActions } from "./concern-actions";

/**
 * A patient's post-care concern: the WhatsApp conversation around it, staff notes, follow-ups and
 * the resolution — everything stays on the patient's file. Staff who handle concerns act from here
 * (reply on WhatsApp, ask for a photo, internal note, book follow-up, mark resolved).
 */
export async function ConcernCard({
  concern,
  thread,
  events,
  locale,
  inboxHref,
  highlighted,
  actions,
}: {
  concern: Concern;
  thread: ChatMessageView[];
  events: ConcernEventView[];
  locale: Locale;
  /** Set only for staff who may open the WhatsApp inbox. */
  inboxHref: string | null;
  highlighted: boolean;
  /** Set for staff who may handle concerns. */
  actions: Omit<Parameters<typeof ConcernActions>[0], "appointmentId" | "open"> | null;
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
          <Badge variant={concern.open ? "outline" : "secondary"} data-testid="concern-state">
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
          <ChatThread messages={thread} events={events} perspective="clinic" showKinds />
        </div>
        {actions ? (
          <ConcernActions appointmentId={concern.appointmentId} open={concern.open} {...actions} />
        ) : (
          <p className="text-muted-foreground text-xs" data-testid="concern-read-only">
            {t("readOnly")}
          </p>
        )}
        {inboxHref && (
          <Link
            href={inboxHref}
            className={buttonVariants({ variant: "ghost", size: "sm", className: "self-start" })}
          >
            <MessageCircle />
            {t("openInbox")}
          </Link>
        )}
      </CardContent>
    </Card>
  );
}
