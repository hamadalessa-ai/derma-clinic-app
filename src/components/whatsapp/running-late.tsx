"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Clock } from "lucide-react";
import { runningLateAction } from "@/app/actions/clinic";
import { FormError, FormSuccess } from "@/components/clinic/form-message";
import { useAction } from "@/components/clinic/use-action";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";

const MINUTES = [10, 15, 20, 30, 45, 60];

/** Calendar: "Doctor running late (X min)" → WhatsApp to that doctor's patients still to come. */
export function RunningLateButton({
  memberId,
  day,
  doctorName,
}: {
  memberId: string;
  day: string;
  doctorName: string;
}) {
  const t = useTranslations("whatsapp");
  const tc = useTranslations("common");
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const { run, pending, error } = useAction();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          setMsg(null);
          setOpen(true);
        }}
        className="text-muted-foreground hover:text-foreground inline-flex shrink-0 items-center gap-1 text-[11px]"
        data-testid="running-late"
        title={t("runningLate")}
      >
        <Clock className="size-3.5" />
        {t("runningLate")}
      </button>
      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("runningLateTitle", { doctor: doctorName })}
        closeLabel={tc("close")}
      >
        <p className="text-muted-foreground text-sm">{t("runningLateHint")}</p>
        <div className="grid grid-cols-3 gap-2" data-testid="running-late-minutes">
          {MINUTES.map((n) => (
            <Button
              key={n}
              variant="outline"
              disabled={pending}
              onClick={() =>
                run(
                  () => runningLateAction({ memberId, day, minutes: n }),
                  (r) => setMsg(t("runningLateSent", { sent: r.sent, affected: r.affected })),
                )
              }
            >
              {t("minutes", { n })}
            </Button>
          ))}
        </div>
        <FormError message={error} />
        <FormSuccess message={msg} />
      </Dialog>
    </>
  );
}
