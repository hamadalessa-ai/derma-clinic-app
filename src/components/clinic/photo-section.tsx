import { withActor, type Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { photosForPatient } from "@/lib/photos/photos";
import { ClinicalPhotos } from "./clinical-photos";

/**
 * Before / after photos for one patient (doctors, nurses, clinic admin; others see nothing).
 * On the patient file's Photos tab, and compact on the visit screen (new photos belong to it).
 */
export async function PhotoSection({
  actor,
  patientId,
  appointmentId,
  compact,
}: {
  actor: Actor;
  patientId: string;
  appointmentId?: string;
  compact?: boolean;
}) {
  if (!can(actor.roles, "photos:view")) return null;
  const data = await withActor(actor, (tx) => photosForPatient(tx, actor, patientId));
  return (
    <ClinicalPhotos
      patientId={patientId}
      appointmentId={appointmentId ?? null}
      data={data}
      canManage={can(actor.roles, "photos:manage")}
      compact={compact}
    />
  );
}
