import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { and, asc, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { ArrowRight, FileText, Layers } from "lucide-react";
import { AlertBadge, StatusBadge } from "@/components/clinic/badges";
import { NotesPanel } from "@/components/clinic/patient-panels";
import { StartVisitButton } from "@/components/clinic/start-visit";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { VideoCall } from "@/components/video/video-call";
import {
  appointments,
  billingItems,
  departments,
  messages,
  patients,
  services,
  users,
} from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { doctorOf } from "@/lib/care-team/care-team";
import { mayWorkOnVisit, visitExtras } from "@/lib/visits/visit";
import { DentalSection } from "@/components/clinic/dental-section";
import { VisitExtras, VisitWorkspace } from "@/components/clinic/visit-workspace";
import { getSettings } from "@/lib/booking/engine";
import type { AppointmentStatus } from "@/lib/booking/status";
import { addMinutes, riyadhDay } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import { notesForPatient } from "@/lib/notes/notes";
import { balanceFor, packagesForPatients } from "@/lib/packages/packages";
import { getPatientAlerts } from "@/lib/patients/queries";
import { videoProvider } from "@/lib/video/provider";
import { DOCTOR_EARLY_MINUTES, loadVisit, videoState } from "@/lib/video/visit";
import type { Locale } from "@/i18n/config";

/** The AI scribe may take a while to draft a long note. */
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Photos the patient sent on WhatsApp in the last N days are shown beside the note. */
const PHOTO_DAYS = 30;

/**
 * The doctor's visit screen: everything for ONE visit on one page — alerts, package, photos,
 * earlier notes, the video call (video visits), and this visit's note with the AI scribe.
 * "Sign & complete" signs the note and completes the visit together.
 */
const CLOSED_STATUSES = ["completed", "cancelled", "no_show"];

export default async function VisitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("my_day:view");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("visit");
  const tv = await getTranslations("video");
  const tc = await getTranslations("calendar");
  const ts = await getTranslations("statuses");
  const td = await getTranslations("dental");
  const actor = actorOf(ctx);

  const data = await withActor(actor, async (tx) => {
    const visit = await loadVisit(tx, id);
    if (!visit) return null;
    const [patient] = await tx
      .select({
        nameAr: patients.fullNameAr,
        nameEn: patients.fullNameEn,
        fileNumber: patients.fileNumber,
      })
      .from(patients)
      .where(eq(patients.id, visit.patientId));
    const [alerts, notes, settings, pkgs, photos] = await Promise.all([
      getPatientAlerts(tx, [visit.patientId]),
      notesForPatient(tx, actor, visit.patientId),
      getSettings(tx),
      packagesForPatients(tx, [visit.patientId]),
      can(ctx.roles, "photos:view")
        ? tx
            .select({ fileId: messages.fileId, createdAt: messages.createdAt })
            .from(messages)
            .where(
              and(
                eq(messages.patientId, visit.patientId),
                eq(messages.direction, "in"),
                isNotNull(messages.fileId),
                gt(messages.createdAt, addMinutes(new Date(), -PHOTO_DAYS * 24 * 60)),
              ),
            )
            .orderBy(desc(messages.createdAt))
            .limit(12)
        : Promise.resolve([]),
    ]);
    // Own doctor — or her nurse / assistant (care team), who prepares the note in the doctor's name.
    const allowed = await mayWorkOnVisit(tx, actor, visit.practitionerId);
    const doctor = allowed ? await doctorOf(tx, visit.practitionerId) : null;
    const extras = allowed
      ? await visitExtras(tx, visit.appointmentId)
      : { charges: [], orders: [] };
    const [flow] = await tx
      .select({ doctorAt: appointments.doctorAt })
      .from(appointments)
      .where(eq(appointments.id, visit.appointmentId));
    // A dental visit shows the tooth chart, the treatment plan and lab work.
    const [dept] = await tx
      .select({ code: departments.code })
      .from(services)
      .innerJoin(departments, eq(departments.id, services.departmentId))
      .where(eq(services.id, visit.serviceId));
    const catalogServices = allowed
      ? await tx
          .select({
            id: services.id,
            code: services.code,
            nameAr: services.nameAr,
            nameEn: services.nameEn,
            priceHalalas: services.priceHalalas,
          })
          .from(services)
          .where(eq(services.isActive, true))
          .orderBy(asc(services.sortOrder))
      : [];
    const catalogItems = allowed
      ? await tx
          .select({
            id: billingItems.id,
            code: billingItems.code,
            nameAr: billingItems.nameAr,
            nameEn: billingItems.nameEn,
            priceHalalas: billingItems.priceHalalas,
            unitAr: billingItems.unitAr,
            unitEn: billingItems.unitEn,
          })
          .from(billingItems)
          .where(eq(billingItems.isActive, true))
          .orderBy(asc(billingItems.code))
      : [];
    // "Entered by" (the nurse) in the screen's language.
    const enteredIds = [
      ...new Set(notes.map((n) => n.enteredByUserId).filter((x): x is string => !!x)),
    ];
    const enteredNames = enteredIds.length
      ? await tx
          .select({ id: users.id, name: users.name, nameEn: users.nameEn })
          .from(users)
          .where(inArray(users.id, enteredIds))
      : [];
    return {
      visit,
      patient,
      enteredNames,
      alerts: alerts.get(visit.patientId),
      notes,
      settings,
      pkgs,
      photos,
      allowed,
      doctor,
      extras,
      doctorCalled: !!flow?.doctorAt,
      dentalVisit: dept?.code === "dental",
      catalog: { services: catalogServices, items: catalogItems },
    };
  });
  if (!data) notFound();
  const { visit } = data;
  if (!data.allowed || !data.doctor) redirect("/forbidden");
  const doctorUserId = data.doctor.userId;
  const preparingFor =
    doctorUserId === ctx.user.id
      ? null
      : { userId: doctorUserId, name: pick(locale, data.doctor.name, data.doctor.nameEn) };

  const status = visit.status as AppointmentStatus;
  const scribeOn =
    can(ctx.roles, "notes:write") &&
    !!process.env.ANTHROPIC_API_KEY?.trim() &&
    data.settings.aiScribeEnabled;
  const patientName = pick(locale, data.patient?.nameAr ?? "", data.patient?.nameEn);
  const thisNote = data.notes.find(
    (n) => n.appointmentId === visit.appointmentId && n.authorUserId === doctorUserId,
  );
  const earlier = data.notes
    .filter((n) => n.status === "signed" && n.appointmentId !== visit.appointmentId)
    .slice(0, 3);
  const balance = balanceFor(data.pkgs, visit.patientId, visit.serviceId);
  const videoNow = visit.isVirtual ? videoState(visit, "doctor") : null;
  const toNoteView = (n: (typeof data.notes)[number]) => ({
    id: n.id,
    status: n.status,
    body: n.body,
    authorUserId: n.authorUserId,
    authorName: n.authorName,
    createdAt: n.createdAt.toISOString(),
    signedAt: n.signedAt?.toISOString() ?? null,
    aiDrafted: !!n.aiDraftedAt,
    enteredByName: (() => {
      const u = data.enteredNames.find((x) => x.id === n.enteredByUserId);
      return u ? pick(locale, u.name, u.nameEn) : n.enteredByName;
    })(),
    appointmentId: n.appointmentId,
    addenda: n.addenda.map((a) => ({
      id: a.id,
      body: a.body,
      authorName: a.authorName,
      createdAt: a.createdAt.toISOString(),
    })),
  });

  return (
    <div className="flex flex-col gap-5" data-testid="visit-screen">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <Link
            href="/my-day"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[13px]"
          >
            <ArrowRight className="size-4 ltr:rotate-180" />
            {t("back")}
          </Link>
          <h1 className="flex flex-wrap items-center gap-2 text-[22px] leading-[30px] font-semibold md:text-[28px] md:leading-9">
            {patientName}
            <AlertBadge alerts={data.alerts} label={tc("allergy")} />
          </h1>
          <p className="text-muted-foreground flex flex-wrap items-center gap-x-2 text-[13px]">
            <span className="font-mono" dir="ltr">
              {data.patient?.fileNumber}
            </span>
            <span>·</span>
            <span>{pick(locale, visit.serviceAr, visit.serviceEn)}</span>
            <span>·</span>
            <span>
              {formatGregorian(visit.startsAt, locale, "medium")}{" "}
              {formatTime(visit.startsAt, locale)}
            </span>
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={status} label={ts(status)} />
          <Link
            href={`/patients/${visit.patientId}`}
            target="_blank"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <FileText />
            {t("fullFile")}
          </Link>
        </div>
      </div>

      {preparingFor && (
        <Notice tone="info" data-testid="assisting-notice">
          {t("assisting", { name: preparingFor.name })}
        </Notice>
      )}
      {visit.consentNeeded && <Notice tone="warning">{t("consentMissing")}</Notice>}

      <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-5">
          {visit.isVirtual && !preparingFor && (
            <Card>
              <CardContent className="flex flex-col gap-3 pt-4 md:pt-5">
                {videoNow === "too_early" && (
                  <Notice tone="info">
                    {tv("doctorTooEarly", { minutes: DOCTOR_EARLY_MINUTES })}
                  </Notice>
                )}
                {videoNow === "ended" && <Notice tone="info">{tv("ended")}</Notice>}
                {videoNow === "cancelled" && <Notice tone="warning">{tv("cancelled")}</Notice>}
                {videoNow === "open" &&
                  (videoProvider() ? (
                    <VideoCall as="doctor" appointmentId={visit.appointmentId} />
                  ) : (
                    <Notice tone="warning">{tv("notConnectedStaff")}</Notice>
                  ))}
              </CardContent>
            </Card>
          )}

          <section className="flex flex-col gap-3" aria-labelledby="visit-note">
            <h2 id="visit-note" className="text-[17px] leading-[26px] font-semibold">
              {t("note")}
            </h2>
            {thisNote && thisNote.status === "draft" && !CLOSED_STATUSES.includes(status) ? (
              <VisitWorkspace
                appointmentId={visit.appointmentId}
                patientId={visit.patientId}
                note={{
                  id: thisNote.id,
                  body: thisNote.body,
                  aiDrafted: !!thisNote.aiDraftedAt,
                  // In the screen's language (the note itself keeps the name it was saved with).
                  authorName: pick(locale, data.doctor.name, data.doctor.nameEn),
                  enteredByName: toNoteView(thisNote).enteredByName,
                }}
                scribe={scribeOn}
                preparingFor={preparingFor?.name ?? null}
                visitDay={riyadhDay(visit.startsAt)}
                handover={
                  preparingFor && status === "in_session" ? { called: data.doctorCalled } : null
                }
                charges={data.extras.charges}
                orders={data.extras.orders}
                catalog={data.catalog}
              />
            ) : thisNote ? (
              <>
                <NotesPanel
                  patientId={visit.patientId}
                  userId={ctx.user.id}
                  scribe={false}
                  canWrite={ctx.roles.includes("practitioner")}
                  appointmentId={visit.appointmentId}
                  visit
                  preparingFor={preparingFor}
                  notes={[toNoteView(thisNote)]}
                />
                <VisitExtras
                  appointmentId={visit.appointmentId}
                  charges={data.extras.charges}
                  orders={data.extras.orders}
                  catalog={data.catalog}
                  locked
                />
              </>
            ) : (
              <Card>
                <CardContent className="flex flex-col items-start gap-3 pt-4 md:pt-5">
                  <p className="text-muted-foreground text-sm">
                    {status === "arrived" ? t("startHint") : t("prepareHint")}
                  </p>
                  <StartVisitButton
                    appointmentId={visit.appointmentId}
                    label={status === "arrived" ? t("start") : t("openNote")}
                  />
                </CardContent>
              </Card>
            )}
          </section>

          {data.dentalVisit && (
            <section className="flex flex-col gap-3" aria-labelledby="visit-dental">
              <h2 id="visit-dental" className="text-[17px] leading-[26px] font-semibold">
                {td("chart")}
              </h2>
              <DentalSection
                actor={actor}
                patientId={visit.patientId}
                appointmentId={visit.appointmentId}
                visitOpen={!CLOSED_STATUSES.includes(status) && status === "in_session"}
                practitionerId={visit.practitionerId}
              />
            </section>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          {balance && (
            <Card>
              <CardContent className="flex items-center justify-between gap-3 pt-4 md:pt-5">
                <span className="flex items-center gap-2 text-sm">
                  <Layers className="text-gold-foreground size-4" />
                  {t("package")}
                </span>
                <span className="bg-gold text-gold-foreground rounded-md px-2 py-0.5 font-mono text-xs">
                  {t("left", { remaining: balance.remaining, total: balance.total })}
                </span>
              </CardContent>
            </Card>
          )}
          {can(ctx.roles, "photos:view") && data.photos.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{tv("photos")}</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-3 gap-2" data-testid="visit-photos">
                  {data.photos.map((p) => (
                    <a
                      key={p.fileId}
                      href={`/api/files/${p.fileId}`}
                      target="_blank"
                      rel="noreferrer"
                      title={`${formatGregorian(p.createdAt, locale)} ${formatTime(p.createdAt, locale)}`}
                    >
                      {/* Private, audited images: never through the image optimiser. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`/api/files/${p.fileId}`}
                        alt={tv("photoAlt")}
                        className="aspect-square w-full rounded-lg border object-cover"
                      />
                    </a>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("earlier")}</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {earlier.length === 0 && (
                <p className="text-muted-foreground text-sm">{t("noEarlier")}</p>
              )}
              {earlier.map((n) => (
                <details key={n.id} className="bg-muted rounded-lg px-3 py-2 text-sm">
                  <summary className="cursor-pointer font-medium">
                    {formatGregorian(n.createdAt, locale, "medium")} · {n.authorName}
                  </summary>
                  <p className="mt-2 leading-6 whitespace-pre-line">{n.body}</p>
                </details>
              ))}
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
