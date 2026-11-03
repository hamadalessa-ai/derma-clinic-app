"use client";

import { Fragment, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import {
  AlertCircle,
  CalendarPlus,
  Camera,
  Check,
  CheckCheck,
  CircleCheck,
  Clock,
  Flag,
  StickyNote,
} from "lucide-react";
import { riyadhParts } from "@/components/clinic/time";
import type { ChatMessageView } from "@/lib/whatsapp/view";
import { cn } from "@/lib/utils";

/** Links in message text become tappable. */
function withLinks(text: string): ReactNode[] {
  return text.split(/(https?:\/\/[^\s]+)/g).map((part, i) =>
    /^https?:\/\//.test(part) ? (
      <a
        key={i}
        href={part}
        target="_blank"
        rel="noreferrer"
        className="text-chat-button break-all underline"
        dir="ltr"
      >
        {part}
      </a>
    ) : (
      <Fragment key={i}>{part}</Fragment>
    ),
  );
}

function Ticks({ status }: { status: string }) {
  if (status === "failed") return <AlertCircle className="text-destructive size-3.5" aria-hidden />;
  if (status === "queued") return <Clock className="size-3.5" aria-hidden />;
  if (status === "sent") return <Check className="size-3.5" aria-hidden />;
  if (status === "read") return <CheckCheck className="text-chat-read size-3.5" aria-hidden />;
  return <CheckCheck className="size-3.5" aria-hidden />; // delivered
}

/** Staff-only things in the timeline (never sent to the patient). */
export interface ConcernEventView {
  id: string;
  kind: "note" | "follow_up_request" | "follow_up" | "resolved";
  body: string | null;
  actorName: string;
  createdAt: string;
  /** follow-up: the time booked or suggested. */
  at: string | null;
}

function EventRow({ e }: { e: ConcernEventView }) {
  const t = useTranslations("concerns");
  const Icon = e.kind === "note" ? StickyNote : e.kind === "resolved" ? CircleCheck : CalendarPlus;
  const when = e.at ? `${riyadhParts(e.at).day} ${riyadhParts(e.at).time}` : "";
  return (
    <div className="flex justify-center" data-testid="concern-event" data-kind={e.kind}>
      <div
        className={cn(
          "flex max-w-[90%] flex-col gap-0.5 rounded-lg px-3 py-1.5 text-sm shadow-sm",
          e.kind === "note" ? "bg-warning text-warning-foreground" : "bg-card text-foreground",
        )}
      >
        <div className="flex items-center gap-1 text-[11px] font-medium">
          <Icon className="size-3.5" aria-hidden />
          {t(`events.${e.kind}`, { name: e.actorName, when })}
        </div>
        {e.body && (
          <div className="break-words whitespace-pre-line" dir="auto">
            {e.body}
          </div>
        )}
        <div className="text-end text-[11px] opacity-80" dir="ltr">
          {riyadhParts(e.createdAt).time}
        </div>
      </div>
    </div>
  );
}

/**
 * A WhatsApp-style chat. perspective "patient" (simulator: the patient's phone) puts the patient's
 * messages on their own side; "clinic" (inbox) puts the clinic's on its side.
 */
export function ChatThread({
  messages,
  perspective,
  onTap,
  tapping,
  showKinds = false,
  events = [],
}: {
  messages: ChatMessageView[];
  perspective: "patient" | "clinic";
  onTap?: (messageId: string, buttonIndex: number) => void;
  tapping?: boolean;
  showKinds?: boolean;
  /** Clinic side only: internal notes, follow-ups, resolved — in time order with the messages. */
  events?: ConcernEventView[];
}) {
  const t = useTranslations("whatsapp");
  const items = [
    ...messages.map((m) => ({ at: m.createdAt, m, e: null })),
    ...(perspective === "clinic" ? events : []).map((e) => ({ at: e.createdAt, m: null, e })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  return (
    <div className="flex flex-col gap-1.5 p-3" data-testid="chat-thread">
      {items.map(({ m, e }) => {
        if (e) return <EventRow key={e.id} e={e} />;
        if (!m) return null;
        const own = perspective === "patient" ? m.direction === "in" : m.direction === "out";
        return (
          <div
            key={m.id}
            className={cn("flex", own ? "justify-end" : "justify-start")}
            data-testid="chat-message"
            data-kind={m.kind}
            data-direction={m.direction}
            data-status={m.status}
          >
            <div className="flex max-w-[85%] flex-col gap-0.5">
              <div
                className={cn(
                  "text-foreground rounded-lg px-2.5 py-1.5 text-sm shadow-sm",
                  own ? "bg-chat-out rounded-se-none" : "bg-chat-in rounded-ss-none",
                  m.flag === "concern" && "ring-destructive ring-2",
                )}
              >
                {showKinds && (
                  <div className="text-chat-meta mb-0.5 flex items-center gap-1 text-[11px] font-medium">
                    {m.flag === "concern" && (
                      <Flag className="text-destructive size-3" aria-hidden />
                    )}
                    {t.has(`kinds.${m.kind}`) ? t(`kinds.${m.kind}`) : m.kind}
                  </div>
                )}
                {m.photo && typeof m.photo === "object" && (
                  // A photo from the patient (doctors and admins only; private, never cached).
                  <a href={m.photo.url} target="_blank" rel="noreferrer" data-testid="chat-photo">
                    {/* eslint-disable-next-line @next/next/no-img-element -- private, uncached image */}
                    <img
                      src={m.photo.url}
                      alt={t("photoAlt")}
                      className="mb-1 max-h-64 rounded-md object-contain"
                    />
                  </a>
                )}
                {(m.photo === "hidden" || (m.kind === "inbound_image" && !m.photo)) && (
                  <div
                    className="text-chat-meta mb-1 flex items-center gap-1 text-xs"
                    data-testid="chat-photo-hidden"
                  >
                    <Camera className="size-4" aria-hidden />
                    {perspective === "clinic" ? t("photoHidden") : t("photoSent")}
                  </div>
                )}
                {!(m.kind === "inbound_image" && m.body === "[photo]") && (
                  <div className="break-words whitespace-pre-line" dir="auto">
                    {withLinks(m.body)}
                  </div>
                )}
                {perspective === "clinic" && m.sentByName && (
                  <div className="text-chat-meta mt-0.5 text-[11px]" data-testid="chat-sender">
                    {t("sentBy", { name: m.sentByName })}
                  </div>
                )}
                <div className="text-chat-meta mt-0.5 flex items-center justify-end gap-1 text-[11px]">
                  <span dir="ltr">{riyadhParts(m.createdAt).time}</span>
                  {m.direction === "out" && <Ticks status={m.status} />}
                </div>
                {m.status === "failed" && (
                  <div className="text-destructive mt-1 text-xs" data-testid="message-error">
                    {m.errorCode && <span dir="ltr">#{m.errorCode} </span>}
                    {m.errorExplained ?? m.errorText}
                  </div>
                )}
              </div>
              {m.buttons.length > 0 && m.direction === "out" && (
                <div className="flex flex-col gap-0.5">
                  {m.buttons.map((b, i) => (
                    <button
                      key={b.id}
                      type="button"
                      disabled={!onTap || tapping}
                      onClick={() => onTap?.(m.id, i)}
                      className="bg-chat-in text-chat-button rounded-lg px-2 py-1.5 text-center text-sm font-medium shadow-sm enabled:cursor-pointer enabled:hover:opacity-90 disabled:cursor-default"
                      data-testid="chat-button"
                      data-button={b.title}
                    >
                      {b.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
