import { getLocale, getTranslations } from "next-intl/server";
import { CalendarClock, ClipboardList, Pill } from "lucide-react";
import { pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import type { InstructionsData } from "@/lib/visits/checkout";
import type { Locale } from "@/i18n/config";

/**
 * The patient's after-visit instructions: medication, treatment plan and next appointments.
 * Printed at checkout, or opened from the WhatsApp care link. Never notes or diagnoses.
 */
export async function InstructionSheet({
  data,
  clinicName,
  fullName,
}: {
  data: InstructionsData;
  clinicName: string;
  /** Print (staff): the full name and file number. The care link shows the first name only. */
  fullName: boolean;
}) {
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("care");
  const name = pick(locale, data.patient.nameAr, data.patient.nameEn);
  const first = name.trim().split(/\s+/)[0] ?? "";
  const a = data.appointment;

  return (
    <div className="flex flex-col gap-5" data-testid="instruction-sheet">
      <header className="flex flex-col gap-1 border-b pb-3">
        <div className="text-brand-strong text-lg font-bold">{clinicName}</div>
        <h1 className="text-[22px] leading-[30px] font-semibold">
          {fullName ? t("titleFor", { name }) : t("title", { name: first })}
        </h1>
        <p className="text-muted-foreground text-sm">
          {pick(locale, data.service.nameAr, data.service.nameEn)} ·{" "}
          {pick(locale, data.doctor.nameAr, data.doctor.nameEn)} ·{" "}
          {formatGregorian(a.startsAt, locale, "full")}
          {fullName && (
            <>
              {" · "}
              <span dir="ltr">{data.patient.fileNumber}</span>
            </>
          )}
        </p>
      </header>

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <Pill className="text-brand-strong size-4" />
          {t("medication")}
        </h2>
        {data.medications.length ? (
          <ul className="flex flex-col gap-2">
            {data.medications.map((m) => (
              <li key={m.id} className="rounded-lg border p-3" data-testid="care-medication">
                <div className="font-medium" dir="auto">
                  {m.name}
                </div>
                <dl className="text-muted-foreground mt-1 grid grid-cols-[auto_1fr] gap-x-3 text-sm">
                  {(
                    [
                      [t("dose"), m.dose],
                      [t("frequency"), m.frequency],
                      [t("duration"), m.duration],
                    ] as const
                  )
                    .filter(([, v]) => v)
                    .map(([label, v]) => (
                      <div key={label} className="contents">
                        <dt>{label}</dt>
                        <dd className="text-foreground">
                          <bdi>{v}</bdi>
                        </dd>
                      </div>
                    ))}
                </dl>
                {m.instructions && (
                  <p className="mt-1 text-sm" dir="auto">
                    {m.instructions}
                  </p>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noMedication")}</p>
        )}
      </section>

      {data.plans.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="flex items-center gap-2 font-semibold">
            <ClipboardList className="text-brand-strong size-4" />
            {t("plan")}
          </h2>
          <ul className="flex flex-col gap-2">
            {data.plans.map((p) => (
              <li key={p.id} className="rounded-lg border p-3">
                <div className="font-medium" dir="auto">
                  {p.name}
                </div>
                {(p.sessions || p.intervalWeeks) && (
                  <div className="text-muted-foreground text-sm">
                    {t("planLine", {
                      sessions: p.sessions ?? "—",
                      weeks: p.intervalWeeks ?? "—",
                    })}
                    {p.service ? ` · ${pick(locale, p.service.nameAr, p.service.nameEn)}` : ""}
                  </div>
                )}
                {p.instructions && (
                  <p className="mt-1 text-sm" dir="auto">
                    {p.instructions}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="flex items-center gap-2 font-semibold">
          <CalendarClock className="text-brand-strong size-4" />
          {t("next")}
        </h2>
        {data.next.length ? (
          <ul className="flex flex-col divide-y rounded-lg border">
            {data.next.map((n) => (
              <li key={n.id} className="flex flex-wrap gap-x-3 px-3 py-2 text-sm">
                <span className="font-medium">
                  {formatGregorian(n.startsAt, locale, "medium")} · {formatTime(n.startsAt, locale)}
                </span>
                <span className="text-muted-foreground">
                  {pick(locale, n.serviceAr, n.serviceEn)} ·{" "}
                  {pick(locale, n.doctorName, n.doctorNameEn)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground text-sm">{t("noNext")}</p>
        )}
      </section>

      <p className="text-muted-foreground border-t pt-3 text-[13px]">{t("footer")}</p>
    </div>
  );
}
