/**
 * "Refresh demo week": moves the demo appointments and blocked time so they surround today
 * again (same working-day pattern, same times). Test bookings made during demos are
 * cancelled first so they can't clash. Demo clinics only; clinic admin only; audited.
 */
import { sql } from "drizzle-orm";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { isDay, riyadhDay } from "@/lib/booking/time";

const newStart = (anchor: string, table: string) =>
  sql.raw(
    `((public.demo_workday('${anchor}'::date, ${table}.demo_day_index) + (${table}.starts_at at time zone 'Asia/Riyadh')::time) at time zone 'Asia/Riyadh')`,
  );

export async function refreshDemoWeek(tx: TenantTx, actor: Actor, today = riyadhDay(new Date())) {
  assertCan(actor.roles, "demo:refresh");
  if (!isDay(today)) throw new Error("bad day");
  const [tenant] = (await tx.execute(
    sql`select is_demo from public.tenants where id = public.app_current_tenant()`,
  )) as unknown as {
    is_demo: boolean;
  }[];
  if (!tenant?.is_demo) throw new Error("not a demo clinic");

  // Overlaps are checked once at the end of the transaction instead of row by row.
  await tx.execute(sql`set constraints public.reservations_no_overlap deferred`);

  const cancelled = await tx.execute(sql`
    update public.appointments
       set status = 'cancelled', cancel_reason = 'إعادة ضبط الأسبوع التجريبي / demo reset'
     where demo_day_index is null and status <> 'cancelled'
    returning id`);
  await tx.execute(sql`delete from public.time_blocks where demo_day_index is null`);

  // Pending requests move together with their appointment.
  await tx.execute(sql`
    update public.reschedule_requests r
       set proposed_starts_at = r.proposed_starts_at + (${newStart(today, "a")} - a.starts_at)
      from public.appointments a
     where a.id = r.appointment_id and a.demo_day_index is not null and r.status = 'pending'`);

  const moved = await tx.execute(sql`
    update public.appointments
       set starts_at = ${newStart(today, "appointments")},
           ends_at = ${newStart(today, "appointments")} + (ends_at - starts_at),
           blocked_until = ${newStart(today, "appointments")} + (blocked_until - starts_at),
           arrived_at = ${newStart(today, "appointments")} + (arrived_at - starts_at),
           in_room_at = ${newStart(today, "appointments")} + (in_room_at - starts_at),
           doctor_at = ${newStart(today, "appointments")} + (doctor_at - starts_at),
           completed_at = ${newStart(today, "appointments")} + (completed_at - starts_at)
     where demo_day_index is not null
    returning id`);
  await tx.execute(sql`
    update public.time_blocks
       set starts_at = ${newStart(today, "time_blocks")},
           ends_at = ${newStart(today, "time_blocks")} + (ends_at - starts_at)
     where demo_day_index is not null`);
  // Memberships keep the same distance to "today" (one ending in 3 days still ends in 3 days).
  await tx.execute(sql`
    update public.patient_memberships m
       set starts_on = m.starts_on + (${today}::date - s.demo_anchor_day),
           ends_on = m.ends_on + (${today}::date - s.demo_anchor_day)
      from public.tenant_settings s
     where s.tenant_id = m.tenant_id and s.demo_anchor_day is not null`);
  await tx.execute(sql`update public.tenant_settings set demo_anchor_day = ${today}::date`);

  await audit(tx, {
    actorUserId: actor.userId,
    action: "demo.refresh_week",
    entityType: "tenant",
    entityId: actor.tenantId,
    metadata: { anchor: today, moved: moved.length, cancelledTestBookings: cancelled.length },
  });
  return { moved: moved.length, cancelled: cancelled.length };
}
