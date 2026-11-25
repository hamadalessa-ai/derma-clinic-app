"use client";

import { useTranslations } from "next-intl";
import { Megaphone } from "lucide-react";
import { callInAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { FormError } from "./form-message";
import { useAction } from "./use-action";

/**
 * "Call in" a waiting patient: they get the room on WhatsApp (reception calls the name when they
 * don't use WhatsApp). After a call it shows "Called n min ago" and offers "Call again".
 */
export function CallInButton({
  appointmentId,
  calledAt,
  now,
  variant = "outline",
}: {
  appointmentId: string;
  calledAt: string | null;
  now: Date;
  variant?: "default" | "outline";
}) {
  const t = useTranslations("flow");
  const act = useAction();
  const mins = calledAt
    ? Math.max(0, Math.floor((now.getTime() - Date.parse(calledAt)) / 60_000))
    : null;
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant={calledAt ? "ghost" : variant}
          loading={act.pending}
          onClick={() => act.run(() => callInAction(appointmentId))}
          data-testid="call-in"
        >
          {!act.pending && <Megaphone />}
          {calledAt ? t("callAgain") : t("callIn")}
        </Button>
        {mins !== null && (
          <span className="text-muted-foreground text-xs" data-testid="called-ago">
            {mins < 1 ? t("calledNow") : t("calledAgo", { minutes: mins })}
          </span>
        )}
      </span>
      <FormError message={act.error} />
    </span>
  );
}
