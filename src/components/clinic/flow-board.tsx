"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { Clock, Receipt, UserCheck, Users } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import {
  FLOW_STAGES,
  flowStage,
  minutesSince,
  needsAttention,
  stageSince,
  type FlowStage,
} from "@/lib/views/flow";
import type { ApptView } from "@/lib/views/schedule";
import { cn } from "@/lib/utils";
import { AppointmentDialog, type AppointmentPermissions } from "./appointment-dialog";
import { AlertBadge, BalanceBadge } from "./badges";
import type { PickOption } from "./booking-dialog";
import { FormError } from "./form-message";
import { riyadhParts } from "./time";
import { useCheckIn } from "./use-check-in";

/** Each column's colour comes from the matching appointment status (theme tokens). */
const STAGE_DOT: Record<FlowStage, string> = {
  expected: "bg-status-confirmed-foreground",
  waiting: "bg-status-arrived-foreground",
  nurse: "bg-status-in-session-foreground",
  doctor: "bg-status-in-session-foreground",
  checkout: "bg-gold-foreground",
  done: "bg-status-completed-foreground",
};

/** On phones the columns stack: waiting and checkout first, then the rooms, expected, done. */
const PHONE_ORDER: Record<FlowStage, string> = {
  expected: "max-md:order-5",
  waiting: "max-md:order-1",
  nurse: "max-md:order-3",
  doctor: "max-md:order-4",
  checkout: "max-md:order-2",
  done: "max-md:order-6",
};

/**
 * Reception's flow board for one day: Expected → Waiting → With nurse → With doctor → Checkout →
 * Done, with
 * how long each patient has been in that step. Long waits and late patients stand out. Check in
 * from the "Expected" column; tap a card for the usual appointment sheet.
 */
export function FlowBoard({
  appointments,
  doctors,
  canManage,
  memberId,
  doctorsManageOwnSchedule,
  day,
  canCheckout,
}: {
  appointments: ApptView[];
  doctors: PickOption[];
  canManage: boolean;
  memberId: string | null;
  doctorsManageOwnSchedule: boolean;
  /** The day shown (YYYY-MM-DD, Riyadh). Times are shown only when it is today. */
  day: string;
  canCheckout: boolean;
}) {
  const t = useTranslations("flow");
  const tc = useTranslations("calendar");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const [openId, setOpenId] = useState<string | null>(null);
  const { checkIn, busyId, error, consentDialog } = useCheckIn();
  // The clock ticks every 30 s so waiting times stay current between data refreshes.
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);

  const isToday = riyadhParts(now.toISOString()).day === day;
  const placed = appointments
    .map((a) => ({ a, stage: flowStage(a) }))
    .filter((x): x is { a: ApptView; stage: FlowStage } => x.stage !== null);
  const open = appointments.find((a) => a.id === openId) ?? null;
  const duration = (m: number) =>
    m < 60 ? t("minutes", { m }) : t("hours", { h: Math.floor(m / 60), m: m % 60 });

  if (!placed.length) {
    return (
      <Card>
        <EmptyState icon={<Users />} title={t("empty")} />
      </Card>
    );
  }

  return (
    <>
      <FormError message={error} />
      <div className="grid gap-3 md:grid-cols-3 2xl:grid-cols-6" data-testid="flow-board">
        {FLOW_STAGES.map((stage) => {
          const cards = placed
            .filter((x) => x.stage === stage)
            .sort((x, y) => stageSince(x.a, stage).localeCompare(stageSince(y.a, stage)));
          return (
            <Card
              key={stage}
              className={cn("flex flex-col", PHONE_ORDER[stage])}
              data-testid="flow-column"
              data-stage={stage}
            >
              <div className="flex items-center gap-2 border-b px-4 py-3">
                <span className={cn("size-2 rounded-full", STAGE_DOT[stage])} />
                <span className="font-semibold">{t(`stage.${stage}`)}</span>
                <span className="text-muted-foreground ms-auto text-sm tabular-nums">
                  {cards.length}
                </span>
              </div>
              <div className="flex flex-col gap-2 p-2">
                {!cards.length && (
                  <p className="text-muted-foreground px-2 py-3 text-center text-[13px]">
                    {t("none")}
                  </p>
                )}
                {cards.map(({ a }) => {
                  const doctor = doctors.find((d) => d.id === a.practitionerId);
                  const since = minutesSince(stageSince(a, stage), now);
                  const late = stage === "expected" && now.getTime() > Date.parse(a.startsAt);
                  const attention = isToday && needsAttention(a, stage, now);
                  return (
                    <div
                      key={a.id}
                      className={cn(
                        "bg-card flex flex-col gap-2 rounded-lg border p-3",
                        attention && "border-warning-foreground",
                      )}
                      data-testid="flow-card"
                      data-patient={a.patient.fileNumber}
                      data-attention={attention || undefined}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-col items-start gap-0.5 text-start"
                        onClick={() => setOpenId(a.id)}
                      >
                        <span className="flex w-full items-center gap-2">
                          <span className="font-mono text-[13px]" dir="ltr">
                            {riyadhParts(a.startsAt).time}
                          </span>
                          <span className="min-w-0 truncate font-medium">{name(a.patient)}</span>
                        </span>
                        <span className="text-muted-foreground text-[13px]">
                          {locale === "en" ? a.serviceNameEn : a.serviceNameAr}
                          {doctor ? ` · ${name(doctor)}` : ""}
                        </span>
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <AlertBadge alerts={a.alerts} label={tc("allergy")} compact />
                        {a.balance && (
                          <BalanceBadge
                            remaining={a.balance.remaining}
                            total={a.balance.total}
                            label={tc("balance")}
                          />
                        )}
                        {a.consent && !a.consent.signed && stage === "expected" && (
                          <span className="bg-warning text-warning-foreground rounded-md px-2 text-xs leading-6">
                            {t("consent")}
                          </span>
                        )}
                        {/* Time shows once it says something: late, or 5+ minutes in a step. */}
                        {isToday && (stage === "expected" ? late : since >= 5) && (
                          <span
                            className={cn(
                              "ms-auto inline-flex h-6 items-center gap-1 rounded-md px-2 text-xs tabular-nums",
                              attention
                                ? "bg-warning text-warning-foreground font-medium"
                                : "text-muted-foreground",
                            )}
                            data-testid="flow-time"
                          >
                            <Clock className="size-3" />
                            {stage === "expected"
                              ? t("late", { time: duration(since) })
                              : stage === "done" || stage === "checkout"
                                ? t("doneAgo", { time: duration(since) })
                                : duration(since)}
                          </span>
                        )}
                      </div>
                      {stage === "checkout" && canCheckout && (
                        <Link
                          href={`/checkout/${a.id}`}
                          className={buttonVariants({ size: "sm", variant: "outline" })}
                          data-testid="flow-checkout"
                        >
                          <Receipt />
                          {t("checkout")}
                        </Link>
                      )}
                      {stage === "expected" && canManage && (
                        <Button
                          size="sm"
                          variant="outline"
                          loading={busyId === a.id}
                          onClick={() => checkIn(a)}
                          data-testid="flow-check-in"
                        >
                          {busyId !== a.id && <UserCheck />}
                          {tc("checkIn")}
                        </Button>
                      )}
                    </div>
                  );
                })}
              </div>
            </Card>
          );
        })}
      </div>

      <AppointmentDialog
        key={openId ?? "none"}
        appt={open}
        onClose={() => setOpenId(null)}
        doctors={doctors}
        perms={
          {
            manage: canManage,
            own: !!open && open.practitionerId === memberId,
            doctorsManageOwnSchedule,
          } satisfies AppointmentPermissions
        }
      />
      {consentDialog}
    </>
  );
}
