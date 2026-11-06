"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { Check, ChevronDown, Circle, Play } from "lucide-react";
import { setClinicStatusAction } from "@/app/actions/clinic";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import type { ClinicStatus } from "@/lib/tenant/status";
import { FormError, FormSuccess } from "./form-message";
import { useAction } from "./use-action";

export interface PlatformClinicRow {
  id: string;
  name: string;
  slug: string;
  brandColor: string;
  isDemo: boolean;
  status: ClinicStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  setup: { step: string; done: boolean }[];
}

const STATUS_BADGE: Record<ClinicStatus, "default" | "secondary" | "destructive" | "gold"> = {
  active: "default",
  read_only: "gold",
  suspended: "destructive",
  closed: "secondary",
};

/** One clinic on the platform page: status, setup progress, and the owner's controls. */
export function PlatformClinic({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const [open, setOpen] = useState(false);
  const done = clinic.setup.filter((s) => s.done).length;
  const total = clinic.setup.length;

  return (
    <Card data-testid="platform-clinic" data-slug={clinic.slug}>
      <CardContent className="flex flex-col gap-4 pt-5">
        <button
          type="button"
          className="flex items-center gap-3 text-start"
          onClick={() => setOpen(!open)}
          aria-expanded={open}
        >
          <span
            className="size-9 shrink-0 rounded-full"
            style={{ background: clinic.brandColor }}
            aria-hidden
          />
          <div className="flex min-w-0 flex-1 flex-col gap-1">
            <div className="flex flex-wrap items-center gap-2 font-semibold">
              {clinic.name}
              <Badge variant={STATUS_BADGE[clinic.status]} data-testid="clinic-status">
                {t(`status.${clinic.status}`)}
              </Badge>
              {clinic.isDemo && <Badge variant="secondary">{t("demo")}</Badge>}
            </div>
            <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
              <span dir="ltr">{clinic.slug}</span>
              <span>{t("setupProgress", { done, total })}</span>
            </div>
            <div className="bg-muted h-1.5 w-full max-w-xs overflow-hidden rounded-full">
              <div
                className="bg-brand h-full rounded-full"
                style={{ width: `${Math.round((done / Math.max(total, 1)) * 100)}%` }}
              />
            </div>
          </div>
          <ChevronDown
            className={cn(
              "text-muted-foreground size-5 transition-transform",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {open && (
          <div className="grid gap-6 border-t pt-4 md:grid-cols-2">
            <section className="flex flex-col gap-2">
              <h3 className="text-sm font-semibold">{t("setupTitle")}</h3>
              <ul className="flex flex-col gap-1.5" data-testid="setup-checklist">
                {clinic.setup.map((s) => (
                  <li key={s.step} className="flex items-center gap-2 text-sm">
                    {s.done ? (
                      <Check className="text-success-foreground size-4" aria-hidden />
                    ) : (
                      <Circle className="text-muted-foreground size-4" aria-hidden />
                    )}
                    <span className={s.done ? "" : "text-muted-foreground"}>
                      {t(`setup.${s.step}`)}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            <StatusControl clinic={clinic} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function StatusControl({ clinic }: { clinic: PlatformClinicRow }) {
  const t = useTranslations("platformClinic");
  const { run, pending, error } = useAction();
  const choices = (["read_only", "suspended", "closed"] as const).filter(
    (s) => s !== clinic.status,
  );
  const [picked, setStatus] = useState<ClinicStatus>(choices[0]);
  // After a change the list of choices changes too; never show a choice that isn't offered.
  const status = choices.includes(picked as (typeof choices)[number]) ? picked : choices[0];
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const apply = (to: ClinicStatus, why: string) =>
    run(
      () => setClinicStatusAction({ tenantId: clinic.id, status: to, reason: why || null }),
      () => {
        setMsg(t("changed", { status: t(`status.${to}`) }));
        setReason("");
      },
    );

  return (
    <section className="flex flex-col gap-3" data-testid="status-control">
      <h3 className="text-sm font-semibold">{t("statusTitle")}</h3>
      {clinic.status !== "active" && (
        <div className="bg-muted flex flex-col gap-2 rounded-lg p-3 text-sm">
          <span>
            {t(`explain.${clinic.status}`)}
            {clinic.statusReason ? ` · ${clinic.statusReason}` : ""}
          </span>
          <Button
            size="sm"
            className="self-start"
            loading={pending}
            onClick={() => apply("active", "")}
            data-testid="clinic-resume"
          >
            <Play />
            {t("resume")}
          </Button>
        </div>
      )}
      <form
        className="flex flex-col gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          apply(status, reason);
        }}
      >
        <div className="flex flex-col gap-1">
          <Label htmlFor={`st-${clinic.id}`}>{t("changeTo")}</Label>
          <Select
            id={`st-${clinic.id}`}
            value={status}
            onChange={(e) => setStatus(e.target.value as ClinicStatus)}
          >
            {choices.map((s) => (
              <option key={s} value={s}>
                {t(`status.${s}`)}
              </option>
            ))}
          </Select>
          <p className="text-muted-foreground text-xs">{t(`explain.${status}`)}</p>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor={`why-${clinic.id}`}>{t("reason")}</Label>
          <Input
            id={`why-${clinic.id}`}
            required
            maxLength={300}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={t("reasonHint")}
          />
        </div>
        <Button
          type="submit"
          variant="outline"
          size="sm"
          className="self-start"
          loading={pending}
          data-testid="clinic-status-apply"
        >
          {t("apply")}
        </Button>
      </form>
      <FormError message={error} />
      <FormSuccess message={msg} />
    </section>
  );
}
