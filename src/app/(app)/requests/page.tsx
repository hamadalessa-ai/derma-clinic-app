import { getLocale, getTranslations } from "next-intl/server";
import { inArray } from "drizzle-orm";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { RequestActions } from "@/components/clinic/request-actions";
import { users } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { formatDualDate, formatTime } from "@/lib/format";
import { pick } from "@/lib/brand";
import { addDays, dayRange, riyadhDay } from "@/lib/booking/time";
import { pendingRequests } from "@/lib/visits/reschedule";
import { loadAppointments } from "@/lib/views/schedule";
import type { Locale } from "@/i18n/config";

export default async function RequestsPage() {
  const ctx = await requirePermission("requests:decide");
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("requests");
  const tc = await getTranslations("common");

  const data = await withActor(actorOf(ctx), async (tx) => {
    const reqs = await pendingRequests(tx);
    const appts = (
      await loadAppointments(tx, { from: new Date("2000-01-01"), to: new Date("2100-01-01") })
    ).filter((a) => reqs.some((r) => r.appointmentId === a.id));
    const requesters = reqs.length
      ? await tx
          .select()
          .from(users)
          .where(
            inArray(
              users.id,
              reqs.map((r) => r.requestedBy),
            ),
          )
      : [];
    return { reqs, appts, requesters };
  });
  const today = riyadhDay(new Date());
  const windowFrom = dayRange(today)[0];
  const windowTo = dayRange(addDays(today, 30))[0];
  const when = (d: Date) =>
    `${formatDualDate(d, locale, "medium").split(" · ")[0]} · ${formatTime(d, locale)}`;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title={t("title")} />
      {data.reqs.length === 0 && (
        <p className="text-muted-foreground py-8 text-center">{t("empty")}</p>
      )}
      {data.reqs.map((r) => {
        const a = data.appts.find((x) => x.id === r.appointmentId);
        const who = data.requesters.find((u) => u.id === r.requestedBy);
        if (!a) return null;
        return (
          <Card key={r.id} data-testid="reschedule-request">
            <CardContent className="flex flex-col gap-2 pt-4 text-sm">
              <div className="text-base font-semibold">
                {pick(locale, a.patient.nameAr, a.patient.nameEn)} ·{" "}
                {locale === "en" ? a.serviceNameEn : a.serviceNameAr}
              </div>
              <div>
                {t("requestedBy")}: {who ? pick(locale, who.name, who.nameEn) : r.requestedBy}
                {r.reason && ` — ${tc("reason")}: ${r.reason}`}
              </div>
              <div className="grid gap-1 sm:grid-cols-2">
                <div>
                  {t("current")}: <strong>{when(new Date(a.startsAt))}</strong>
                </div>
                <div>
                  {t("proposed")}: <strong>{when(r.proposedStartsAt)}</strong>
                </div>
              </div>
              <RequestActions requestId={r.id} />
            </CardContent>
          </Card>
        );
      })}
      <AutoRefresh
        versionUrl={`/api/calendar/version?from=${encodeURIComponent(windowFrom.toISOString())}&to=${encodeURIComponent(windowTo.toISOString())}`}
      />
    </div>
  );
}
