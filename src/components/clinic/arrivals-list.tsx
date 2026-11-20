"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CalendarCheck, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import type { Locale } from "@/i18n/config";
import type { ApptView } from "@/lib/views/schedule";
import { AppointmentDialog, type AppointmentPermissions } from "./appointment-dialog";
import { AlertBadge, BalanceBadge, StatusBadge } from "./badges";
import type { PickOption } from "./booking-dialog";
import { FormError } from "./form-message";
import { riyadhParts } from "./time";
import { useCheckIn } from "./use-check-in";

/**
 * Reception's "Arrivals" list: today's appointments in time order, one "Check in" button per
 * row (useCheckIn: a needed consent opens the signature sheet first).
 */
export function ArrivalsList({
  appointments,
  doctors,
  canManage,
  memberId,
  doctorsManageOwnSchedule,
}: {
  appointments: ApptView[];
  doctors: PickOption[];
  canManage: boolean;
  memberId: string | null;
  doctorsManageOwnSchedule: boolean;
}) {
  const t = useTranslations("calendar");
  const ts = useTranslations("statuses");
  const locale = useLocale() as Locale;
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;
  const [openId, setOpenId] = useState<string | null>(null);
  const { checkIn, busyId, error, consentDialog } = useCheckIn();
  const rows = appointments.filter((a) => a.status !== "cancelled");
  const open = rows.find((a) => a.id === openId) ?? null;

  if (!rows.length) {
    return (
      <Card>
        <EmptyState icon={<CalendarCheck />} title={t("noArrivals")} />
      </Card>
    );
  }

  return (
    <>
      <FormError message={error} />
      <Card className="divide-y overflow-hidden" data-testid="arrivals">
        {rows.map((a) => {
          const doctor = doctors.find((d) => d.id === a.practitionerId);
          const waiting = a.status === "booked" || a.status === "confirmed";
          return (
            <div
              key={a.id}
              className="hover:bg-muted/60 flex flex-wrap items-center gap-3 px-4 py-3 transition-colors"
              data-testid="arrival-row"
              data-status={a.status}
              data-patient={a.patient.fileNumber}
            >
              <span className="w-12 shrink-0 font-mono text-sm" dir="ltr">
                {riyadhParts(a.startsAt).time}
              </span>
              <button
                type="button"
                className="flex min-w-0 flex-1 flex-col items-start text-start"
                onClick={() => setOpenId(a.id)}
              >
                <span className="flex flex-wrap items-center gap-1.5 font-medium">
                  {name(a.patient)}
                  <AlertBadge alerts={a.alerts} label={t("allergy")} compact />
                  {a.balance && (
                    <BalanceBadge
                      remaining={a.balance.remaining}
                      total={a.balance.total}
                      label={t("balance")}
                    />
                  )}
                </span>
                <span className="text-muted-foreground text-[13px]">
                  {locale === "en" ? a.serviceNameEn : a.serviceNameAr}
                  {doctor ? ` · ${name(doctor)}` : ""}
                  {a.consent && !a.consent.signed ? ` · ${t("consentNeeded")}` : ""}
                </span>
              </button>
              {waiting && canManage ? (
                <Button
                  size="sm"
                  loading={busyId === a.id}
                  onClick={() => checkIn(a)}
                  data-testid="arrival-check-in"
                >
                  {busyId !== a.id && <UserCheck />}
                  {t("checkIn")}
                </Button>
              ) : (
                <StatusBadge status={a.status} label={ts(a.status)} />
              )}
            </div>
          );
        })}
      </Card>

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
