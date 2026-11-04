import Link from "next/link";
import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { CalendarPlus, Users } from "lucide-react";
import { asc, eq } from "drizzle-orm";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LinkTabs } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { AlertBadge, BalanceBadge, StatusBadge } from "@/components/clinic/badges";
import { ConcernCard } from "@/components/clinic/concern-card";
import {
  AlertsEditor,
  ConsentsPanel,
  NotesPanel,
  PackagesPanel,
  type PackageView,
} from "@/components/clinic/patient-panels";
import { conversations, patientMedicalFlags } from "@/db/schema";
import { WhatsAppConsentCard } from "@/components/whatsapp/consent-card";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { pick } from "@/lib/brand";
import { consentsForPatient, currentTemplates, isIntact } from "@/lib/consents/consents";
import { formatDualDate, formatGregorian } from "@/lib/format";
import { notesForPatient } from "@/lib/notes/notes";
import {
  activeTemplates,
  packagesForPatients,
  paymentSummary,
  paymentsFor,
  sessionEventsFor,
} from "@/lib/packages/packages";
import { getFamily, getPatient, getPatientAlerts } from "@/lib/patients/queries";
import { loadAppointments } from "@/lib/views/schedule";
import { concernCards } from "@/lib/whatsapp/concern-view";
import { riyadhDay, riyadhTime } from "@/lib/booking/time";
import { getSettings } from "@/lib/booking/engine";
import type { Locale } from "@/i18n/config";

/** The AI scribe may take a while to draft a long note. */
export const maxDuration = 60;

const TABS = ["overview", "visits", "packages", "consents", "notes"] as const;
type Tab = (typeof TABS)[number];
const UUID_RE = /^[0-9a-f-]{36}$/i;

export default async function PatientProfilePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string; appointment?: string; concern?: string }>;
}) {
  const ctx = await requirePermission("patients:read");
  const { id } = await params;
  const sp = await searchParams;
  if (!UUID_RE.test(id)) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("patientsX");
  const tw = await getTranslations("whatsapp");
  const tp = await getTranslations("patients");
  const ts = await getTranslations("statuses");
  const tc = await getTranslations("calendar");
  const tco = await getTranslations("common");
  const canNotes = can(ctx.roles, "clinical_notes:read");
  const tabs = TABS.filter((x) => x !== "notes" || canNotes);
  const tab: Tab = (tabs as readonly string[]).includes(sp.tab ?? "")
    ? (sp.tab as Tab)
    : "overview";
  const actor = { ...actorOf(ctx) };
  // Opened from a "patient concern" notification (or My Day): show that concern first.
  const concernId = sp.concern && UUID_RE.test(sp.concern) ? sp.concern : null;

  // AI scribe: the clinic switched it on and a key is set (doctors who can write notes only).
  const scribeOn =
    can(ctx.roles, "notes:write") &&
    !!process.env.ANTHROPIC_API_KEY?.trim() &&
    (await withActor(actor, (tx) => getSettings(tx))).aiScribeEnabled;
  const data = await withActor(actor, async (tx) => {
    const patient = await getPatient(tx, id);
    if (!patient) return null;
    const [alerts, flags, family, appts, pkgMap, consents, templates, pkgTemplates, notes] =
      await Promise.all([
        getPatientAlerts(tx, [id]),
        tx
          .select()
          .from(patientMedicalFlags)
          .where(eq(patientMedicalFlags.patientId, id))
          .orderBy(asc(patientMedicalFlags.createdAt)),
        getFamily(tx, patient),
        loadAppointments(tx, {
          patientId: id,
          from: new Date("2000-01-01"),
          to: new Date("2100-01-01"),
        }),
        packagesForPatients(tx, [id]),
        consentsForPatient(tx, id),
        currentTemplates(tx),
        activeTemplates(tx),
        canNotes ? notesForPatient(tx, actor, id) : Promise.resolve([]),
      ]);
    const pkgs = pkgMap.get(id) ?? [];
    const [payments, events] = await Promise.all([
      paymentsFor(
        tx,
        pkgs.map((p) => p.id),
      ),
      sessionEventsFor(
        tx,
        pkgs.map((p) => p.id),
      ),
    ]);
    // Post-care concerns: the open ones, and the one the link asked for (even if resolved).
    const concerns = await concernCards(tx, actor, {
      patientId: id,
      highlight: concernId,
      locale,
    });
    const [convo] = await tx
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.phone, patient.phone))
      .limit(1);
    return {
      concerns,
      conversationId: convo?.id ?? null,
      patient,
      alerts: alerts.get(id),
      flags,
      family,
      appts,
      pkgs,
      payments,
      events,
      consents,
      templates,
      pkgTemplates,
      notes,
    };
  });
  if (!data) notFound();
  const p = data.patient;
  const now = new Date();

  const packages: PackageView[] = data.pkgs.map((pkg) => {
    const pays = data.payments.filter((x) => x.patientPackageId === pkg.id);
    const sum = paymentSummary(pkg.priceHalalas, pays);
    return {
      id: pkg.id,
      nameAr: pkg.nameAr,
      nameEn: pkg.nameEn,
      sessionsTotal: pkg.sessionsTotal,
      sessionsUsed: pkg.sessionsUsed,
      priceHalalas: pkg.priceHalalas,
      paidHalalas: sum.paid,
      outstandingHalalas: sum.outstanding,
      paymentStatus: sum.status,
      expiresAt: pkg.expiresAt.toISOString(),
      expired: pkg.expiresAt <= now,
      events: data.events
        .filter((e) => e.patientPackageId === pkg.id)
        .map((e) => ({
          id: e.id,
          kind: e.kind,
          delta: e.delta,
          reason: e.reason,
          createdAt: e.createdAt.toISOString(),
        })),
    };
  });
  const age = p.dateOfBirth
    ? Math.floor((now.getTime() - new Date(p.dateOfBirth).getTime()) / (365.25 * 86400_000))
    : null;
  const href = (x: string) => `/patients/${id}?tab=${x}`;
  const familyLink = (f: {
    id: string;
    fullNameAr: string;
    fullNameEn: string | null;
    fileNumber: string;
  }) => (
    <Link key={f.id} href={`/patients/${f.id}`} className="text-brand underline">
      {pick(locale, f.fullNameAr, f.fullNameEn)} ({f.fileNumber})
    </Link>
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold">
            {pick(locale, p.fullNameAr, p.fullNameEn)}
            <AlertBadge alerts={data.alerts} label={tc("allergy")} />
          </h1>
          <p className="text-muted-foreground text-sm">
            <span dir="ltr">{p.fileNumber}</span> · <span dir="ltr">{p.phone}</span> ·{" "}
            {tp(p.gender)}
            {age !== null && ` · ${t("age", { age })}`} · {t("fakeData")}
          </p>
        </div>
        {can(ctx.roles, "appointments:manage") && (
          <Link href={`/calendar?patient=${id}`} className={buttonVariants()}>
            <CalendarPlus />
            {t("bookFor")}
          </Link>
        )}
      </div>

      {data.concerns.map((c) => (
        <ConcernCard
          key={c.concern.appointmentId}
          {...c}
          locale={locale}
          highlighted={c.concern.appointmentId === concernId}
        />
      ))}

      <LinkTabs active={tab} tabs={tabs.map((x) => ({ key: x, label: t(x), href: href(x) }))} />

      {tab === "overview" && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>{t("overview")}</CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">{t("nameAr")}</dt>
                <dd>{p.fullNameAr}</dd>
                <dt className="text-muted-foreground">{t("nameEn")}</dt>
                <dd dir="ltr" className="text-start">
                  {p.fullNameEn ?? "—"}
                </dd>
                <dt className="text-muted-foreground">{t("idType")}</dt>
                <dd>{p.idType ? t(p.idType) : "—"}</dd>
                <dt className="text-muted-foreground">{t("idNumber")}</dt>
                <dd dir="ltr" className="text-start">
                  {p.idNumber ?? "—"}
                </dd>
                <dt className="text-muted-foreground">{tp("dateOfBirth")}</dt>
                <dd>
                  {p.dateOfBirth
                    ? formatGregorian(new Date(`${p.dateOfBirth}T12:00:00Z`), locale)
                    : "—"}
                </dd>
                <dt className="text-muted-foreground">{tp("phone")}</dt>
                <dd dir="ltr" className="text-start">
                  {p.phone}
                </dd>
              </dl>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{t("alerts")}</CardTitle>
            </CardHeader>
            <CardContent>
              <AlertsEditor
                patientId={id}
                flags={data.flags.map((f) => ({
                  id: f.id,
                  kind: f.kind,
                  label: f.label,
                  note: f.note,
                }))}
                canEdit={can(ctx.roles, "patients:edit") || can(ctx.roles, "notes:write")}
              />
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>{tw("consentTitle")}</CardTitle>
            </CardHeader>
            <CardContent>
              <WhatsAppConsentCard
                patientId={id}
                optInAt={p.whatsappOptInAt?.toISOString() ?? null}
                optInSource={p.whatsappOptInSource}
                optedOutAt={p.whatsappOptedOutAt?.toISOString() ?? null}
                language={p.preferredLanguage === "en" ? "en" : "ar"}
                conversationId={data.conversationId}
                canEdit={can(ctx.roles, "whatsapp:inbox")}
                formatDate={Object.fromEntries(
                  [p.whatsappOptInAt, p.whatsappOptedOutAt]
                    .filter((d): d is Date => !!d)
                    .map((d) => [
                      d.toISOString(),
                      formatDualDate(d, locale, "medium").split(" · ")[0],
                    ]),
                )}
              />
            </CardContent>
          </Card>
          {(data.family.guardian ||
            data.family.dependants.length > 0 ||
            data.family.siblings.length > 0) && (
            <Card data-testid="family">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Users className="size-5" />
                  {t("family")}
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm">
                {data.family.guardian && (
                  <div>
                    {t("guardian")}: {familyLink(data.family.guardian)}{" "}
                    {p.guardianRelationAr &&
                      `· ${pick(locale, p.guardianRelationAr, p.guardianRelationEn)}`}
                  </div>
                )}
                {data.family.dependants.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t("dependants")}: {data.family.dependants.map(familyLink)}
                  </div>
                )}
                {data.family.siblings.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {t("siblings")}: {data.family.siblings.map(familyLink)}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "visits" && (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{tco("date")}</TableHead>
                  <TableHead>{tco("service")}</TableHead>
                  <TableHead className="hidden sm:table-cell">{tc("balance")}</TableHead>
                  <TableHead>{tco("status")}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {[...data.appts].reverse().map((a) => (
                  <TableRow key={a.id}>
                    <TableCell>
                      <span className="hidden sm:inline">
                        {formatDualDate(new Date(a.startsAt), locale, "medium")}
                      </span>
                      <span className="whitespace-nowrap sm:hidden" dir="ltr">
                        {riyadhDay(new Date(a.startsAt))} {riyadhTime(new Date(a.startsAt))}
                      </span>
                    </TableCell>
                    <TableCell>{locale === "en" ? a.serviceNameEn : a.serviceNameAr}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {a.balance && (
                        <BalanceBadge
                          remaining={a.balance.remaining}
                          total={a.balance.total}
                          label={tc("balance")}
                        />
                      )}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={a.status} label={ts(a.status)} />
                    </TableCell>
                  </TableRow>
                ))}
                {data.appts.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={4} className="text-muted-foreground py-6 text-center">
                      {t("noVisits")}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {tab === "packages" && (
        <PackagesPanel
          patientId={id}
          packages={packages}
          templates={data.pkgTemplates.map((x) => ({
            id: x.id,
            nameAr: x.nameAr,
            nameEn: x.nameEn,
            priceHalalas: x.priceHalalas,
          }))}
          canSell={can(ctx.roles, "packages:sell")}
          canOverride={can(ctx.roles, "packages:override")}
        />
      )}

      {tab === "consents" && (
        <ConsentsPanel
          patient={{ id, nameAr: p.fullNameAr }}
          signed={data.consents.map((c) => ({
            id: c.id,
            titleAr: c.titleAr,
            titleEn: c.titleEn,
            version: c.templateVersion,
            signedAt: c.signedAt.toISOString(),
            signerName: c.signerName,
            intact: isIntact(c),
          }))}
          templates={data.templates.map((x) => ({
            id: x.id,
            code: x.code,
            version: x.version,
            titleAr: x.titleAr,
            titleEn: x.titleEn,
            bodyAr: x.bodyAr,
            bodyEn: x.bodyEn,
          }))}
          canCollect={can(ctx.roles, "consents:collect")}
        />
      )}

      {tab === "notes" && canNotes && (
        <>
          <NotesPanel
            patientId={id}
            userId={ctx.user.id}
            scribe={scribeOn}
            canWrite={can(ctx.roles, "notes:write")}
            appointmentId={sp.appointment && UUID_RE.test(sp.appointment) ? sp.appointment : null}
            notes={data.notes.map((n) => ({
              id: n.id,
              status: n.status,
              body: n.body,
              authorUserId: n.authorUserId,
              authorName: n.authorName,
              createdAt: n.createdAt.toISOString(),
              signedAt: n.signedAt?.toISOString() ?? null,
              aiDrafted: !!n.aiDraftedAt,
              appointmentId: n.appointmentId,
              addenda: n.addenda.map((a) => ({
                id: a.id,
                body: a.body,
                authorName: a.authorName,
                createdAt: a.createdAt.toISOString(),
              })),
            }))}
          />
        </>
      )}
    </div>
  );
}
