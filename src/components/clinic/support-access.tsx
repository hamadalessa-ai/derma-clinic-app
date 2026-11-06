"use client";

import { useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { LifeBuoy } from "lucide-react";
import { endSupportAction, grantSupportAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

const HOURS = [1, 4, 24, 72] as const;

/** Settings → Team: let the platform's support open the clinic for a few hours (or end it). */
export function SupportAccess({
  active,
  activity,
}: {
  active: { expiresAt: string; allowChanges: boolean } | null;
  activity: { at: string; action: string; path: string | null }[];
}) {
  const t = useTranslations("support");
  const format = useFormatter();
  const { run, pending, error } = useAction();
  const [msg, setMsg] = useState<string | null>(null);
  const [hours, setHours] = useState<number>(4);
  const [allowChanges, setAllowChanges] = useState(false);
  const [reason, setReason] = useState("");

  return (
    <div className="flex flex-col gap-4" data-testid="support-access">
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      {active ? (
        <div className="bg-gold flex flex-col gap-2 rounded-xl p-4 text-sm">
          <span className="font-semibold">
            {t("activeUntil", {
              time: format.dateTime(new Date(active.expiresAt), {
                dateStyle: "medium",
                timeStyle: "short",
              }),
            })}
          </span>
          <span>{active.allowChanges ? t("modeChanges") : t("modeView")}</span>
          <Button
            size="sm"
            variant="outline"
            className="self-start"
            loading={pending}
            onClick={() =>
              run(
                () => endSupportAction(),
                () => setMsg(t("ended")),
              )
            }
            data-testid="support-end"
          >
            {t("endNow")}
          </Button>
        </div>
      ) : (
        <form
          className="flex flex-col gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(
              () => grantSupportAction({ hours, allowChanges, reason: reason || null }),
              () => setMsg(t("granted")),
            );
          }}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <Label htmlFor="support-hours">{t("duration")}</Label>
              <Select
                id="support-hours"
                value={hours}
                onChange={(e) => setHours(Number(e.target.value))}
              >
                {HOURS.map((h) => (
                  <option key={h} value={h}>
                    {t("hours", { n: h })}
                  </option>
                ))}
              </Select>
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="support-reason">{t("reason")}</Label>
              <Input
                id="support-reason"
                maxLength={300}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={t("reasonHint")}
              />
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="accent-brand size-4"
              checked={allowChanges}
              onChange={(e) => setAllowChanges(e.target.checked)}
            />
            {t("allowChanges")}
          </label>
          <p className="text-muted-foreground text-xs">{t("rules")}</p>
          <Button
            type="submit"
            className="self-start"
            loading={pending}
            data-testid="support-grant"
          >
            <LifeBuoy />
            {t("grant")}
          </Button>
        </form>
      )}
      <FormError message={error} />
      <FormSuccess message={msg} />
      {activity.length > 0 && (
        <div className="flex flex-col gap-1">
          <h4 className="text-sm font-semibold">{t("activityTitle")}</h4>
          <ul className="text-muted-foreground flex flex-col gap-0.5 text-xs">
            {activity.map((a, i) => (
              <li key={i} className="flex justify-between gap-2">
                <span>{a.action === "support.change" ? t("didChange") : (a.path ?? "")}</span>
                <span dir="ltr">
                  {format.dateTime(new Date(a.at), { dateStyle: "short", timeStyle: "short" })}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
