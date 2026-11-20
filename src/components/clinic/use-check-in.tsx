"use client";

import { useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { checkInAction } from "@/app/actions/clinic";
import { useToast } from "@/components/ui/toast";
import type { ApptView } from "@/lib/views/schedule";
import { ConsentSignDialog, type ConsentTemplateView } from "./consent-sign-dialog";
import { useAction } from "./use-action";

/**
 * Reception's check-in, shared by the Arrivals list and the flow board: one tap; if a consent is
 * needed the signature sheet opens and the check-in finishes on "Sign".
 */
export function useCheckIn() {
  const t = useTranslations("calendar");
  const locale = useLocale();
  const toast = useToast();
  const { run, error } = useAction();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [consent, setConsent] = useState<{ appt: ApptView; template: ConsentTemplateView } | null>(
    null,
  );
  const name = (o: { nameAr: string; nameEn: string | null }) =>
    locale === "en" && o.nameEn ? o.nameEn : o.nameAr;

  const checkIn = (a: ApptView) => {
    setBusyId(a.id);
    run(
      () => checkInAction(a.id),
      (r) => {
        setBusyId(null);
        if (r.status === "consent_required") {
          setConsent({ appt: a, template: r.template });
          return;
        }
        const who = name(a.patient);
        if (r.status === "already_checked_in") toast(t("alreadyCheckedIn"), "info");
        else if (r.deducted && r.remaining !== null && a.balance)
          toast(
            `${t("checkedInName", { name: who })} — ${t("deducted", { remaining: r.remaining, total: a.balance.total })}`,
          );
        else toast(t("checkedInName", { name: who }));
      },
    );
  };

  const consentDialog = consent ? (
    <ConsentSignDialog
      open
      template={consent.template}
      patient={{ id: consent.appt.patient.id, nameAr: consent.appt.patient.nameAr }}
      appointmentId={consent.appt.id}
      onClose={() => setConsent(null)}
      onSigned={() => {
        const a = consent.appt;
        setConsent(null);
        checkIn(a); // consent signed → finish the check-in
      }}
    />
  ) : null;

  return { checkIn, busyId, error, consentDialog };
}
