"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { bookFollowUpRequestAction, decideRequestAction, statusAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

export function RequestActions({ requestId }: { requestId: string }) {
  const t = useTranslations("requests");
  const [note, setNote] = useState("");
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t("note")}
          className="max-w-64"
          aria-label={t("note")}
        />
        <Button
          disabled={pending}
          onClick={() =>
            run(() => decideRequestAction({ requestId, approve: true, note: note || undefined }))
          }
        >
          {t("approve")}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(() => decideRequestAction({ requestId, approve: false, note: note || undefined }))
          }
        >
          {t("reject")}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

/** Approve or reject an online booking that awaits approval ("pending"). */
export function PendingBookingActions({ appointmentId }: { appointmentId: string }) {
  const t = useTranslations("calendar");
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap gap-2">
        <Button
          disabled={pending}
          data-testid="approve"
          onClick={() => run(() => statusAction({ appointmentId, to: "confirmed" }))}
        >
          {t("approve")}
        </Button>
        <Button
          variant="outline"
          disabled={pending}
          data-testid="reject"
          onClick={() =>
            run(() => statusAction({ appointmentId, to: "cancelled", reason: t("rejectedReason") }))
          }
        >
          {t("reject")}
        </Button>
      </div>
      <FormError message={error} />
    </div>
  );
}

/** A doctor's follow-up request: book it at the suggested time, or at another day/time. */
export function FollowUpRequestActions({
  requestId,
  day: suggestedDay,
  time: suggestedTime,
}: {
  requestId: string;
  day: string;
  time: string;
}) {
  const t = useTranslations("requests");
  const [other, setOther] = useState(false);
  const [day, setDay] = useState(suggestedDay);
  const [time, setTime] = useState(suggestedTime);
  const { run, pending, error } = useAction();
  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          disabled={pending}
          data-testid="followup-request-book"
          onClick={() => run(() => bookFollowUpRequestAction({ requestId }))}
        >
          {t("bookSuggested", { time: suggestedTime })}
        </Button>
        <Button variant="outline" disabled={pending} onClick={() => setOther(!other)}>
          {t("otherTime")}
        </Button>
      </div>
      {other && (
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="date"
            value={day}
            onChange={(e) => setDay(e.target.value)}
            className="w-auto"
            aria-label={t("day")}
          />
          <Input
            type="time"
            step={300}
            value={time}
            onChange={(e) => setTime(e.target.value)}
            className="w-auto"
            aria-label={t("time")}
          />
          <Button
            disabled={pending || !day || !time}
            onClick={() => run(() => bookFollowUpRequestAction({ requestId, day, time }))}
          >
            {t("bookThis")}
          </Button>
        </div>
      )}
      <FormError message={error} />
    </div>
  );
}
