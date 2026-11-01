/**
 * Scheduled WhatsApp messages: reminders, post-care check-ins, no-show follow-ups and recalls.
 * Called every hour by GitHub Actions (/api/cron/messages), once a day by Vercel Cron as a safety
 * net, and in demo mode by the admin's "Run scheduled messages now" button.
 *
 *  - SAFE TO RUN TWICE (even at the same moment): every message has a dedupe key (send.ts).
 *  - CATCH-UP: each type is sent while it is still useful, not only "this minute"
 *    (a reminder any time from 24 h until 2 h before the visit), so a missed or late run is fine.
 *  - QUIET HOURS: nothing between 22:00 and 08:00 Riyadh time; it goes out after 08:00.
 *    (Verification codes don't use the scheduler, so they are never held back.)
 *  - Demo only: "fast-forward 24 hours" sends what would be due a day from now, and quiet hours
 *    can be ignored — so a live demo works at any time of day.
 */
import { and, asc, eq, gt, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import { appointments, services } from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { sendNoShowFollowUp, sendPostCare, sendRecall, sendReminder } from "./outbox";
import type { SendOutcome, Tenant } from "./send";

type Env = Record<string, string | undefined>;
const HOUR = 3600_000;

export const QUIET_HOURS = { from: 22, to: 8 }; // Riyadh time

export function riyadhHour(date: Date) {
  return new Date(date.getTime() + 3 * HOUR).getUTCHours();
}

export function inQuietHours(date: Date) {
  const h = riyadhHour(date);
  return h >= QUIET_HOURS.from || h < QUIET_HOURS.to;
}

export interface RunOptions {
  now?: Date;
  /** Demo: act as if it were this many hours later (0 or 24). */
  fastForwardHours?: number;
  /** Demo: send even between 22:00 and 08:00. */
  ignoreQuietHours?: boolean;
  env?: Env;
}

export interface RunSummary {
  quietHours: boolean;
  sent: Record<string, number>;
  skipped: Record<string, number>;
  failed: Record<string, number>;
}

/** Which appointments are due for each scheduled message at time `due`. */
export async function dueWork(tenantId: string, due: Date) {
  return withTenant(tenantId, async (tx) => {
    const reminders = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startsAt, new Date(due.getTime() + 2 * HOUR)),
          lte(appointments.startsAt, new Date(due.getTime() + 24 * HOUR)),
        ),
      )
      .orderBy(asc(appointments.startsAt));

    // Post-care: 24 hours after the visit ended (or was completed), for up to 3 days.
    const finished = sql`least(${appointments.endsAt}, ${appointments.updatedAt})`;
    const postCare = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.status, "completed"),
          isNotNull(services.postCareAr),
          sql`${finished} <= ${new Date(due.getTime() - 24 * HOUR).toISOString()}::timestamptz`,
          sql`${finished} >= ${new Date(due.getTime() - 72 * HOUR).toISOString()}::timestamptz`,
        ),
      );

    const noShows = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .where(
        and(
          eq(appointments.status, "no_show"),
          lte(appointments.startsAt, new Date(due.getTime() - 2 * HOUR)),
          gte(appointments.startsAt, new Date(due.getTime() - 72 * HOUR)),
        ),
      );

    // Recalls: the LAST completed visit for a service with a recall delay, once the delay has
    // passed (sent within 30 days of it), and no newer booking for that service since.
    const recallCandidates = await tx
      .select({
        id: appointments.id,
        patientId: appointments.patientId,
        serviceId: appointments.serviceId,
        startsAt: appointments.startsAt,
        recallDays: services.recallAfterDays,
      })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.status, "completed"),
          isNotNull(services.recallAfterDays),
          sql`${appointments.startsAt} <= ${due.toISOString()}::timestamptz - make_interval(days => ${services.recallAfterDays})`,
          sql`${appointments.startsAt} >= ${due.toISOString()}::timestamptz - make_interval(days => ${services.recallAfterDays} + 30)`,
        ),
      );
    const recalls: { id: string }[] = [];
    for (const c of recallCandidates) {
      const [newer] = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.patientId, c.patientId),
            eq(appointments.serviceId, c.serviceId),
            gt(appointments.startsAt, c.startsAt),
            ne(appointments.status, "cancelled"),
          ),
        )
        .limit(1);
      if (!newer) recalls.push({ id: c.id });
    }
    return { reminders, postCare, noShows, recalls };
  });
}

export async function runScheduledMessages(
  tenant: Tenant,
  options: RunOptions = {},
): Promise<RunSummary> {
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const summary: RunSummary = { quietHours: false, sent: {}, skipped: {}, failed: {} };
  if (inQuietHours(now) && !options.ignoreQuietHours) {
    summary.quietHours = true;
    return summary;
  }
  const due = new Date(now.getTime() + (options.fastForwardHours ?? 0) * HOUR);
  const work = await dueWork(tenant.id, due);
  const count = (kind: string, r: SendOutcome) => {
    const bucket =
      r.outcome === "sent"
        ? summary.sent
        : r.outcome === "failed"
          ? summary.failed
          : summary.skipped;
    bucket[kind] = (bucket[kind] ?? 0) + 1;
  };
  for (const a of work.reminders) count("reminder", await sendReminder(tenant, a.id, env));
  for (const a of work.postCare) count("post_care", await sendPostCare(tenant, a.id, env));
  for (const a of work.noShows) count("no_show", await sendNoShowFollowUp(tenant, a.id, env));
  for (const a of work.recalls) count("recall", await sendRecall(tenant, a.id, env));
  return summary;
}
