"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CalendarPlus, Camera, CircleCheck, Send, StickyNote } from "lucide-react";
import {
  concernAskPhotoAction,
  concernFollowUpAction,
  concernFollowUpTimesAction,
  concernNoteAction,
  concernReplyAction,
  concernResolveAction,
} from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Notice } from "@/components/ui/notice";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

type Panel = "note" | "followUp" | "resolve" | null;

/**
 * What staff can do about a concern, from the Concern card: reply on WhatsApp (signed with their
 * name, 24-hour window), ask for a photo, internal note, book follow-up, mark resolved.
 */
export function ConcernActions({
  appointmentId,
  canReplyFreely,
  windowEndsAt,
  followUpMode,
  services,
  defaultServiceId,
  today,
  open,
  compact = false,
}: {
  appointmentId: string;
  canReplyFreely: boolean;
  /** "HH:MM" when the 24-hour window closes. */
  windowEndsAt: string | null;
  /** "book": booked now; "request": sent to reception (doctors don't manage their schedule). */
  followUpMode: "book" | "request";
  services: { id: string; name: string }[];
  defaultServiceId: string;
  /** Riyadh date, YYYY-MM-DD. */
  today: string;
  open: boolean;
  /** The inbox has its own reply box: only note / follow-up / resolve here. */
  compact?: boolean;
}) {
  const t = useTranslations("concerns");
  const [panel, setPanel] = useState<Panel>(null);
  const [reply, setReply] = useState("");
  const [note, setNote] = useState("");
  const [resolveNote, setResolveNote] = useState("");
  const [serviceId, setServiceId] = useState(defaultServiceId);
  const [day, setDay] = useState(today);
  const [times, setTimes] = useState<{ startsAt: string; time: string }[] | null>(null);
  const [time, setTime] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  const toggle = (p: Panel) => {
    setDone(null);
    setPanel(panel === p ? null : p);
  };

  return (
    <div className="flex flex-col gap-3" data-testid="concern-actions">
      {compact ? null : canReplyFreely ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => concernReplyAction({ appointmentId, text: reply }),
              () => {
                setReply("");
                setDone(t("replySent"));
              },
            );
          }}
        >
          <Label htmlFor={`reply-${appointmentId}`}>{t("replyLabel")}</Label>
          <Textarea
            id={`reply-${appointmentId}`}
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={3}
            required
            data-testid="concern-reply-text"
          />
          <p className="text-muted-foreground text-xs">
            {t("replyHint")}
            {windowEndsAt && ` ${t("windowEnds", { time: windowEndsAt })}`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              disabled={pending || !reply.trim()}
              data-testid="concern-reply-send"
            >
              <Send className="rtl:rotate-180" />
              {t("send")}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              data-testid="concern-ask-photo"
              onClick={() =>
                run(
                  () => concernAskPhotoAction({ appointmentId }),
                  () => setDone(t("photoAsked")),
                )
              }
            >
              <Camera />
              {t("askPhoto")}
            </Button>
          </div>
        </form>
      ) : (
        <Notice tone="warning" data-testid="concern-outside-window">
          {t("outsideWindow")}
        </Notice>
      )}

      <div className="flex flex-wrap gap-2">
        <Button
          variant={panel === "note" ? "default" : "outline"}
          size="sm"
          onClick={() => toggle("note")}
          data-testid="concern-note-open"
        >
          <StickyNote />
          {t("noteButton")}
        </Button>
        <Button
          variant={panel === "followUp" ? "default" : "outline"}
          size="sm"
          onClick={() => toggle("followUp")}
          data-testid="concern-followup-open"
        >
          <CalendarPlus />
          {t("followUpButton")}
        </Button>
        {open && (
          <Button
            variant={panel === "resolve" ? "default" : "outline"}
            size="sm"
            onClick={() => toggle("resolve")}
            data-testid="concern-resolve-open"
          >
            <CircleCheck />
            {t("resolveButton")}
          </Button>
        )}
      </div>

      {panel === "note" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`note-${appointmentId}`}>{t("noteLabel")}</Label>
          <Textarea
            id={`note-${appointmentId}`}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            data-testid="concern-note-text"
          />
          <Button
            className="self-end"
            size="sm"
            disabled={pending || !note.trim()}
            data-testid="concern-note-save"
            onClick={() =>
              run(
                () => concernNoteAction({ appointmentId, text: note }),
                () => {
                  setNote("");
                  setPanel(null);
                  setDone(t("noteSaved"));
                },
              )
            }
          >
            {t("noteSave")}
          </Button>
        </div>
      )}

      {panel === "followUp" && (
        <div
          className="flex flex-col gap-2"
          data-testid="concern-followup"
          data-mode={followUpMode}
        >
          <p className="text-muted-foreground text-xs">
            {followUpMode === "book" ? t("followUpBookHint") : t("followUpRequestHint")}
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor={`fu-service-${appointmentId}`}>{t("service")}</Label>
              <Select
                id={`fu-service-${appointmentId}`}
                value={serviceId}
                onChange={(e) => {
                  setServiceId(e.target.value);
                  setTimes(null);
                  setTime(null);
                }}
                data-testid="followup-service"
              >
                {services.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor={`fu-day-${appointmentId}`}>{t("day")}</Label>
              <Input
                id={`fu-day-${appointmentId}`}
                type="date"
                min={today}
                value={day}
                onChange={(e) => {
                  setDay(e.target.value);
                  setTimes(null);
                  setTime(null);
                }}
                data-testid="followup-day"
              />
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            disabled={pending || !day}
            data-testid="followup-find"
            onClick={() =>
              run(
                () => concernFollowUpTimesAction({ appointmentId, serviceId, day }),
                (r) => setTimes(r),
              )
            }
          >
            {t("findTimes")}
          </Button>
          {times && (
            <div className="flex flex-wrap gap-1.5" data-testid="followup-times">
              {times.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("noTimes")}</p>
              )}
              {times.map((s) => (
                <Button
                  key={s.startsAt}
                  size="sm"
                  variant={time === s.time ? "default" : "outline"}
                  data-time={s.time}
                  dir="ltr"
                  onClick={() => setTime(s.time)}
                >
                  {s.time}
                </Button>
              ))}
            </div>
          )}
          {time && (
            <Button
              className="self-end"
              disabled={pending}
              data-testid="followup-confirm"
              onClick={() =>
                run(
                  () => concernFollowUpAction({ appointmentId, serviceId, day, time }),
                  (r) => {
                    setPanel(null);
                    setTimes(null);
                    setTime(null);
                    setDone(r.mode === "book" ? t("followUpBooked") : t("followUpRequested"));
                  },
                )
              }
            >
              {followUpMode === "book"
                ? t("followUpBook", { time })
                : t("followUpRequest", { time })}
            </Button>
          )}
        </div>
      )}

      {panel === "resolve" && (
        <div className="flex flex-col gap-2">
          <Label htmlFor={`resolve-${appointmentId}`}>{t("resolveNote")}</Label>
          <Textarea
            id={`resolve-${appointmentId}`}
            value={resolveNote}
            onChange={(e) => setResolveNote(e.target.value)}
            rows={2}
            data-testid="concern-resolve-note"
          />
          <Button
            className="self-end"
            size="sm"
            disabled={pending}
            data-testid="concern-resolve-confirm"
            onClick={() =>
              run(
                () => concernResolveAction({ appointmentId, note: resolveNote || undefined }),
                () => {
                  setPanel(null);
                  setDone(t("resolved"));
                },
              )
            }
          >
            <CircleCheck />
            {t("resolveConfirm")}
          </Button>
        </div>
      )}
      <FormError message={error} />
      <FormSuccess message={done} />
    </div>
  );
}
