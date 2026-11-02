"use client";

import { useState, useTransition } from "react";
import { useLocale, useTranslations } from "next-intl";
import { Sparkles } from "lucide-react";
import { rescheduleOptionsAction } from "@/app/actions/clinic";
import { Button } from "@/components/ui/button";

type Doctor = { nameAr: string; nameEn: string | null } | null;
type Options =
  | { ok: false; reason: string }
  | {
      ok: true;
      doctor: Doctor;
      sameDoctor: string[];
      otherDoctors: { practitionerId: string; doctor: Doctor; times: string[] }[];
    };

/**
 * Move dialog helper: the free times on the chosen day — the same doctor first; if that doctor is
 * full, other doctors (reception only). Tapping a time fills in the time (and doctor).
 */
export function MoveFreeTimes({
  appointmentId,
  day,
  onPick,
}: {
  appointmentId: string;
  day: string;
  onPick: (time: string, practitionerId?: string) => void;
}) {
  const t = useTranslations("calendar");
  const te = useTranslations("errors");
  const locale = useLocale();
  const name = (d: Doctor) => (d ? (locale === "en" && d.nameEn ? d.nameEn : d.nameAr) : "");
  const [options, setOptions] = useState<Options | null>(null);
  const [pending, start] = useTransition();
  const chip =
    "border-input bg-card hover:bg-accent rounded-md border px-2 py-1 text-xs font-medium";

  return (
    <div className="flex flex-col gap-2 sm:col-span-3" data-testid="move-free-times">
      <Button
        type="button"
        size="sm"
        variant="outline"
        className="self-start"
        disabled={pending || !day}
        onClick={() =>
          start(async () => {
            const r = await rescheduleOptionsAction({ appointmentId, day });
            if (!r.ok) {
              setOptions({ ok: false, reason: te.has(r.error) ? te(r.error) : te("unexpected") });
              return;
            }
            setOptions(
              r.data.ok
                ? r.data
                : { ok: false, reason: te.has(r.data.reason) ? te(r.data.reason) : r.data.reason },
            );
          })
        }
        data-testid="show-free-times"
      >
        <Sparkles />
        {t("freeTimesThatDay")}
      </Button>
      {options && !options.ok && (
        <p className="bg-warning text-warning-foreground rounded-md px-3 py-2 text-sm">
          {options.reason}
        </p>
      )}
      {options?.ok && (
        <>
          {options.sameDoctor.length ? (
            <div className="flex flex-wrap gap-1.5" data-testid="same-doctor-times">
              {options.sameDoctor.map((time) => (
                <button
                  key={time}
                  type="button"
                  className={chip}
                  dir="ltr"
                  onClick={() => onPick(time)}
                >
                  {time}
                </button>
              ))}
            </div>
          ) : (
            <p className="text-sm" data-testid="doctor-full">
              {t("doctorFullThatDay", { doctor: name(options.doctor) })}
            </p>
          )}
          {options.otherDoctors.map((d) => (
            <div
              key={d.practitionerId}
              className="flex flex-col gap-1"
              data-testid="other-doctor-times"
            >
              <span className="text-muted-foreground text-xs">{name(d.doctor)}</span>
              <div className="flex flex-wrap gap-1.5">
                {d.times.map((time) => (
                  <button
                    key={time}
                    type="button"
                    className={chip}
                    dir="ltr"
                    onClick={() => onPick(time, d.practitionerId)}
                  >
                    {time}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {options.sameDoctor.length === 0 && options.otherDoctors.length === 0 && (
            <p className="text-muted-foreground text-sm">{t("nobodyFreeThatDay")}</p>
          )}
        </>
      )}
    </div>
  );
}
