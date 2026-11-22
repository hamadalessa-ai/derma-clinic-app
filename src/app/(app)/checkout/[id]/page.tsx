import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ArrowRight, ClipboardList, Printer, Receipt } from "lucide-react";
import { AlertBadge } from "@/components/clinic/badges";
import { BookPlanSession, PaymentForm, SendInstructions } from "@/components/clinic/checkout-panel";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { messages, services, tenantMembers, users } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { riyadhDay } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import { getPatientAlerts } from "@/lib/patients/queries";
import { checkoutData } from "@/lib/visits/checkout";
import { VisitError } from "@/lib/visits/visit";
import type { Locale } from "@/i18n/config";

const UUID_RE = /^[0-9a-f-]{36}$/i;
const sar = (h: number) => (h / 100).toFixed(2);

/**
 * Reception's checkout of a posted visit: the invoice lines (package sessions at 0), payment and
 * the clinic system's invoice number, the next sessions of the treatment plan, and the patient's
 * instructions (print or WhatsApp link).
 */
export default async function CheckoutPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("visits:checkout");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const actor = actorOf(ctx);
  const data = await withActor(actor, async (tx) => {
    const d = await checkoutData(tx, actor, id).catch((e) => {
      if (e instanceof VisitError) return null;
      throw e;
    });
    if (!d) return null;
    const alerts = (await getPatientAlerts(tx, [d.patient.id])).get(d.patient.id);
    const svcIds = [...new Set(d.suggestions.map((s) => s.serviceId))];
    const docIds = [
      ...new Set([
        ...d.suggestions.flatMap((s) => (s.slot ? [s.slot.practitionerId] : [])),
        ...d.upcoming.map((u) => u.practitionerId),
      ]),
    ];
    const upSvc = [...new Set([...svcIds, ...d.upcoming.map((u) => u.serviceId)])];
    const [svcRows, docRows, sent, checkedOutBy] = await Promise.all([
      upSvc.length
        ? tx
            .select({ id: services.id, nameAr: services.nameAr, nameEn: services.nameEn })
            .from(services)
            .where(inArray(services.id, upSvc))
        : [],
      docIds.length
        ? tx
            .select({ id: tenantMembers.id, nameAr: users.name, nameEn: users.nameEn })
            .from(tenantMembers)
            .innerJoin(users, eq(users.id, tenantMembers.userId))
            .where(inArray(tenantMembers.id, docIds))
        : [],
      tx
        .select({ createdAt: messages.createdAt })
        .from(messages)
        .where(and(eq(messages.appointmentId, id), eq(messages.kind, "visit_instructions")))
        .orderBy(desc(messages.createdAt))
        .limit(1),
      d.checkout
        ? tx
            .select({ name: users.name, nameEn: users.nameEn })
            .from(users)
            .where(eq(users.id, d.checkout.checkedOutByUserId))
        : [],
    ]);
    return {
      ...d,
      alerts,
      svcRows,
      docRows,
      sentAt: sent[0]?.createdAt.toISOString() ?? null,
      checkedOutBy: checkedOutBy[0] ?? null,
    };
  });
  if (!data) notFound();

  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("checkout");
  const tv = await getTranslations("visit");
  const tc = await getTranslations("calendar");
  const a = data.appointment;
  const posted = a.status === "completed";
  const svc = (sid: string) => data.svcRows.find((s) => s.id === sid);
  const doc = (mid: string) => data.docRows.find((d) => d.id === mid);
  const name = (o?: { nameAr: string; nameEn: string | null } | null) =>
    o ? pick(locale, o.nameAr, o.nameEn) : "";
  const meds = data.orders.filter((o) => o.kind === "medication");
  const plans = data.orders.filter((o) => o.kind === "treatment");
  const back = `/calendar?view=flow&date=${riyadhDay(a.startsAt)}`;

  return (
    <div className="flex flex-col gap-4" data-testid="checkout-screen">
      <Link
        href={back}
        className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm"
      >
        <ArrowRight className="size-4 ltr:rotate-180" />
        {t("back")}
      </Link>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t("title")} · {pick(locale, data.patient.fullNameAr, data.patient.fullNameEn)}
            <AlertBadge alerts={data.alerts} label={tc("allergy")} compact />
          </span>
        }
        subtitle={`${data.patient.fileNumber} · ${name(data.service)} · ${name(data.doctor)} · ${formatGregorian(a.startsAt, locale, "medium")} ${formatTime(a.startsAt, locale)}`}
      />
      {!posted && <Notice tone="warning">{t("notPosted")}</Notice>}

      <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
        <div className="flex flex-col gap-4">
          <Card data-testid="checkout-lines">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Receipt className="text-brand-strong size-4" />
                {t("invoice")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="flex flex-col divide-y rounded-lg border">
                {data.lines.map((l, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                    <span className="text-muted-foreground font-mono text-xs" dir="ltr">
                      {l.code}
                    </span>
                    <span className="min-w-0 flex-1">{pick(locale, l.nameAr, l.nameEn)}</span>
                    {l.coveredByPackage ? (
                      <span className="bg-gold text-gold-foreground rounded-md px-2 text-xs leading-6">
                        {l.coveredByMembership ? tv("membership") : tv("package")}
                      </span>
                    ) : (
                      <span className="text-muted-foreground text-xs tabular-nums" dir="ltr">
                        {l.quantity} × {sar(l.unitPriceHalalas)}
                      </span>
                    )}
                    <span className="w-24 text-end font-medium tabular-nums" dir="ltr">
                      {sar(l.coveredByPackage ? 0 : l.quantity * l.unitPriceHalalas)}
                    </span>
                  </li>
                ))}
                {data.discount > 0 && data.membership && (
                  <li
                    className="flex items-center justify-between px-3 py-2 text-sm"
                    data-testid="checkout-discount"
                  >
                    <span>
                      {t("memberDiscount", {
                        plan: pick(locale, data.membership.nameAr, data.membership.nameEn),
                        percent: data.membership.discountPercent,
                      })}
                    </span>
                    <span className="tabular-nums" dir="ltr">
                      −{sar(data.discount)}
                    </span>
                  </li>
                )}
                <li className="flex items-center justify-between px-3 py-2 font-semibold">
                  <span>{t("due")}</span>
                  <span dir="ltr" data-testid="checkout-due">
                    {sar(data.due)} {tv("sar")}
                  </span>
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card data-testid="checkout-plan">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <ClipboardList className="text-brand-strong size-4" />
                {t("nextSessions")}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {data.suggestions.length ? (
                <ul className="flex flex-col divide-y rounded-lg border">
                  {data.suggestions.map((s) => (
                    <li
                      key={`${s.orderId}-${s.index}`}
                      className="flex flex-wrap items-center gap-3 px-3 py-2"
                      data-testid="plan-suggestion"
                    >
                      <div className="flex min-w-0 flex-1 flex-col">
                        <span className="font-medium">
                          {t("session", { n: s.index })} · {name(svc(s.serviceId))}
                        </span>
                        <span className="text-muted-foreground text-[13px]">
                          {s.bookedAppointmentId
                            ? t("alreadyBooked")
                            : s.slot
                              ? `${formatGregorian(new Date(`${s.slot.day}T12:00:00+03:00`), locale, "medium")} · ${s.slot.time} · ${name(doc(s.slot.practitionerId))}`
                              : t("noSlot", {
                                  date: formatGregorian(
                                    new Date(`${s.targetDay}T12:00:00+03:00`),
                                    locale,
                                    "medium",
                                  ),
                                })}
                        </span>
                      </div>
                      {s.slot && !s.bookedAppointmentId && (
                        <BookPlanSession
                          branchId={a.branchId}
                          patientId={a.patientId}
                          serviceId={s.serviceId}
                          practitionerId={s.slot.practitionerId}
                          day={s.slot.day}
                          time={s.slot.time}
                        />
                      )}
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-muted-foreground text-sm">
                  {plans.length ? t("planNoService") : t("noPlan")}
                </p>
              )}
              {data.upcoming.length > 0 && (
                <div className="flex flex-col gap-1">
                  <span className="text-sm font-medium">{t("upcoming")}</span>
                  <ul className="text-muted-foreground flex flex-col gap-0.5 text-[13px]">
                    {data.upcoming.map((u) => (
                      <li key={u.id}>
                        {formatGregorian(u.startsAt, locale, "medium")} ·{" "}
                        {formatTime(u.startsAt, locale)} · {name(svc(u.serviceId))} ·{" "}
                        {name(doc(u.practitionerId))}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="flex flex-col gap-4">
          <Card data-testid="checkout-payment">
            <CardHeader>
              <CardTitle className="text-base">{t("payment")}</CardTitle>
            </CardHeader>
            <CardContent>
              {data.checkout ? (
                <dl
                  className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm"
                  data-testid="checkout-done"
                >
                  <dt className="text-muted-foreground">{t("paid")}</dt>
                  <dd className="font-medium" dir="ltr">
                    {sar(data.checkout.paidHalalas)} {tv("sar")}
                  </dd>
                  <dt className="text-muted-foreground">{t("method")}</dt>
                  <dd>
                    {data.checkout.method ? t(`methods.${data.checkout.method}`) : t("noPayment")}
                  </dd>
                  {data.checkout.invoiceNumber && (
                    <>
                      <dt className="text-muted-foreground">{t("invoiceNumber")}</dt>
                      <dd dir="ltr">{data.checkout.invoiceNumber}</dd>
                    </>
                  )}
                  <dt className="text-muted-foreground">{t("by")}</dt>
                  <dd>
                    <bdi>
                      {data.checkedOutBy
                        ? pick(locale, data.checkedOutBy.name, data.checkedOutBy.nameEn)
                        : "—"}
                    </bdi>{" "}
                    ·{" "}
                    <bdi>
                      {formatGregorian(data.checkout.createdAt, locale, "medium")}{" "}
                      {formatTime(data.checkout.createdAt, locale)}
                    </bdi>
                  </dd>
                </dl>
              ) : posted ? (
                <PaymentForm appointmentId={a.id} dueHalalas={data.due} />
              ) : (
                <p className="text-muted-foreground text-sm">{t("notPosted")}</p>
              )}
            </CardContent>
          </Card>

          <Card data-testid="checkout-instructions">
            <CardHeader>
              <CardTitle className="text-base">{t("instructions")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="text-muted-foreground text-sm">
                {t("instructionsHint", { meds: meds.length, plans: plans.length })}
              </p>
              {posted && (
                <div className="flex flex-wrap items-start gap-2">
                  <Link
                    href={`/instructions/${a.id}`}
                    target="_blank"
                    className={buttonVariants({ variant: "outline" })}
                    data-testid="print-instructions"
                  >
                    <Printer />
                    {t("print")}
                  </Link>
                  <SendInstructions appointmentId={a.id} sentAt={data.sentAt} />
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
