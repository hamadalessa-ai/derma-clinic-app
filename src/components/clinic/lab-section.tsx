import { withActor, type Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { labsForPatient } from "@/lib/labs/labs";
import { LabResults } from "./lab-results";

/**
 * Lab results for one patient (doctors and nurses only; others see nothing). On the patient
 * file's Labs tab, and compact on the visit screen (then new results belong to that visit).
 */
export async function LabSection({
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
  if (!can(actor.roles, "labs:view")) return null;
  const data = await withActor(actor, (tx) => labsForPatient(tx, actor, patientId));
  return (
    <LabResults
      patientId={patientId}
      appointmentId={appointmentId ?? null}
      data={data}
      canEdit={can(actor.roles, "labs:manage")}
      compact={compact}
    />
  );
}
