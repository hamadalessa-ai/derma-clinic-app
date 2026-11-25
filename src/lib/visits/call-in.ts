/**
 * "Call in": a waiting (arrived) patient is called into the room. The time is recorded (the board
 * shows "called 2 min ago") and the patient gets a WhatsApp message with the room and doctor
 * (sent after the change is saved: outbox.sendRoomCall). Without WhatsApp, reception calls the name.
 * Reception and admins may call anyone in their branch; a doctor her own patients; a nurse the
 * patients of the doctors she assists.
 */
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { BookingError, getAppointment, markCalledIn } from "@/lib/booking/engine";
import { mayWorkOnVisit } from "./visit";

export async function callIn(tx: TenantTx, actor: Actor, appointmentId: string) {
  const appt = await getAppointment(tx, appointmentId, true);
  const allowed =
    can(actor.roles, "appointments:manage") ||
    (can(actor.roles, "notes:write") && (await mayWorkOnVisit(tx, actor, appt.practitionerId)));
  if (!allowed) throw new BookingError("not_allowed");
  const updated = await markCalledIn(tx, appointmentId);
  await audit(tx, {
    actorUserId: actor.userId,
    action: "appointment.call_in",
    entityType: "appointment",
    entityId: appointmentId,
  });
  return updated;
}
