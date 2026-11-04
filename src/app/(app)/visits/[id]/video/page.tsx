import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { and, desc, eq, gt, isNotNull } from "drizzle-orm";
import { FileText } from "lucide-react";
import { AlertBadge } from "@/components/clinic/badges";
import { NotesPanel } from "@/components/clinic/patient-panels";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { VideoCall } from "@/components/video/video-call";
import { messages, patients } from "@/db/schema";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { getSettings } from "@/lib/booking/engine";
import { addMinutes } from "@/lib/booking/time";
import { pick } from "@/lib/brand";
import { formatGregorian, formatTime } from "@/lib/format";
import { notesForPatient } from "@/lib/notes/notes";
import { getPatientAlerts } from "@/lib/patients/queries";
import { videoProvider } from "@/lib/video/provider";
import { DOCTOR_EARLY_MINUTES, loadVisit, videoState } from "@/lib/video/visit";
import type { Locale } from "@/i18n/config";

/** The AI scribe may take a while to draft a long note. */
export const maxDuration = 60;

const UUID_RE = /^[0-9a-f-]{36}$/i;
/** Photos the patient sent on WhatsApp in the last N days are shown beside the call. */
const PHOTO_DAYS = 30;

/**
 * The doctor's video consultation screen: the call, and beside it the patient's alerts, the
 * photos they sent, and this visit's note with the AI scribe (the call keeps running).
 */
export default async function VideoVisitPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("video:join");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("video");
  const tc = await getTranslations("calendar");
  const actor = actorOf(ctx);

  const data = await withActor(actor, async (tx) => {
    const visit = await loadVisit(tx, id);
    if (!visit || !visit.isVirtual) return null;
    const [patient] = await tx
      .select({ nameAr: patients.fullNameAr, nameEn: patients.fullNameEn })
      .from(patients)
      .where(eq(patients.id, visit.patientId));
    const [alerts, notes, settings, photos] = await Promise.all([
      getPatientAlerts(tx, [visit.patientId]),
      notesForPatient(tx, actor, visit.patientId),
      getSettings(tx),
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
    return { visit, patient, alerts: alerts.get(visit.patientId), notes, settings, photos };
  });
  if (!data) notFound();
  const { visit } = data;
  // Only the appointment's own doctor joins the call.
  if (visit.practitionerId !== ctx.memberId) redirect("/forbidden");

  const state = videoState(visit, "doctor");
  const scribeOn = !!process.env.ANTHROPIC_API_KEY?.trim() && data.settings.aiScribeEnabled;
  const patientName = pick(locale, data.patient?.nameAr ?? "", data.patient?.nameEn);

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("doctorTitle", { name: patientName })}
        subtitle={`${pick(locale, visit.serviceAr, visit.serviceEn)} · ${formatGregorian(visit.startsAt, locale, "full")} · ${formatTime(visit.startsAt, locale)}`}
        actions={
          <Link
            href={`/patients/${visit.patientId}`}
            target="_blank"
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <FileText />
            {t("openFile")}
          </Link>
        }
      />
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="flex flex-col gap-3">
          {visit.consentNeeded && <Notice tone="warning">{t("doctorConsentMissing")}</Notice>}
          {state === "cancelled" && <Notice tone="warning">{t("cancelled")}</Notice>}
          {state === "ended" && <Notice tone="info">{t("ended")}</Notice>}
          {state === "too_early" && (
            <Notice tone="info">{t("doctorTooEarly", { minutes: DOCTOR_EARLY_MINUTES })}</Notice>
          )}
          {state === "open" && !videoProvider() && (
            <Notice tone="warning">{t("notConnectedStaff")}</Notice>
          )}
          {state === "open" && videoProvider() && (
            <VideoCall as="doctor" appointmentId={visit.appointmentId} />
          )}
          <p className="text-muted-foreground text-xs">{t("doctorPrivacy")}</p>
        </div>

        <div className="flex flex-col gap-4">
          {data.alerts && (
            <div>
              <AlertBadge alerts={data.alerts} label={tc("allergy")} />
            </div>
          )}
          {can(ctx.roles, "photos:view") && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">{t("photos")}</CardTitle>
              </CardHeader>
              <CardContent>
                {data.photos.length === 0 ? (
                  <p className="text-muted-foreground text-sm">{t("noPhotos")}</p>
                ) : (
                  <div className="grid grid-cols-3 gap-2" data-testid="video-photos">
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
                          alt={t("photoAlt")}
                          className="aspect-square w-full rounded-md border object-cover"
                        />
                      </a>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">{t("note")}</CardTitle>
            </CardHeader>
            <CardContent>
              <NotesPanel
                patientId={visit.patientId}
                userId={ctx.user.id}
                scribe={scribeOn && can(ctx.roles, "notes:write")}
                canWrite={can(ctx.roles, "notes:write")}
                appointmentId={visit.appointmentId}
                notes={data.notes
                  .filter((n) => n.appointmentId === visit.appointmentId)
                  .map((n) => ({
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
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
