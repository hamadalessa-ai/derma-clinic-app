/**
 * Scheduled WhatsApp messages: reminders, visit-day "I've arrived" messages (self check-in, 1–4
 * hours before a clinic visit), post-care check-ins, no-show follow-ups, recalls and membership
 * renewals (3 days before a period ends).
 * Called every hour by GitHub Actions (/api/cron/messages), once a day by Vercel Cron as a safety
 * net, and in demo mode by the admin's "Run scheduled messages now" button.
 *
 *  - SAFE TO RUN TWICE (even at the same moment): every message has a dedupe key (send.ts).
 *  - CATCH-UP: each type is sent while it is still useful, not only "this minute"
 *    (a reminder any time from 24 h until 2 h before the visit), so a missed or late run is fine.
 *  - QUIET HOURS: nothing between 22:00 and 08:00 Riyadh time; it goes out after 08:00.
 *    (Verification codes don't use the scheduler, so they are never held back.)
 *  - FAST + RESUMABLE: what was already sent is skipped in one query (message_dispatches), a few
 *    messages go out at a time, and a run stops starting new sends before its time budget is up —
 *    `more: true` tells the caller to call again (the hourly job loops), picking up where it stopped.
 *  - Demo only: "fast-forward 24 hours" sends what would be due a day from now, and quiet hours
 *    can be ignored — so a live demo works at any time of day.
 */
import { and, asc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import {
  appointments,
  messageDispatches,
  patientMemberships,
  services,
  tenantSettings,
} from "@/db/schema";
import { withTenant } from "@/db/tenant";
import { addDays, riyadhDay } from "@/lib/booking/time";
import {
  SCHEDULED_KEYS,
  sendArrivalInvite,
  sendMembershipRenewal,
  sendNoShowFollowUp,
  sendPostCare,
  sendRecall,
  sendReminder,
} from "./outbox";
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
  /** Stop starting new sends after this many ms (default 40 s); the rest goes on the next call. */
  budgetMs?: number;
}

/** Messages sent at the same time (one clinic). Keeps the run fast without flooding the provider. */
export const SEND_CONCURRENCY = 4;
export const DEFAULT_BUDGET_MS = 40_000;

export interface RunSummary {
  quietHours: boolean;
  sent: Record<string, number>;
  skipped: Record<string, number>;
  failed: Record<string, number>;
  /** Not everything due was sent in this run's time budget: call again. */
  more: boolean;
}

/** Which appointments are due for each scheduled message at time `due`. */
export async function dueWork(tenantId: string, due: Date) {
  return withTenant(tenantId, async (tx) => {
    const reminders = await tx
      .select({ id: appointments.id, startsAt: appointments.startsAt })
      .from(appointments)
      .where(
        and(
          inArray(appointments.status, ["booked", "confirmed"]),
          gte(appointments.startsAt, new Date(due.getTime() + 2 * HOUR)),
          lte(appointments.startsAt, new Date(due.getTime() + 24 * HOUR)),
        ),
      )
      .orderBy(asc(appointments.startsAt));

    // Visit day, self check-in on: clinic visits starting in 1–4 hours get "tap I've arrived".
    const [settings] = await tx
      .select({ on: tenantSettings.selfCheckInEnabled })
      .from(tenantSettings);
    const arrivals = settings?.on
      ? await tx
          .select({ id: appointments.id, startsAt: appointments.startsAt })
          .from(appointments)
          .innerJoin(services, eq(services.id, appointments.serviceId))
          .where(
            and(
              inArray(appointments.status, ["booked", "confirmed"]),
              eq(services.isVirtual, false),
              gte(appointments.startsAt, new Date(due.getTime() + 1 * HOUR)),
              lte(appointments.startsAt, new Date(due.getTime() + 4 * HOUR)),
            ),
          )
      : [];

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
    // (One query: "no newer booking" is a NOT EXISTS, not a lookup per candidate.)
    const newer = sql`not exists (
      select 1 from ${appointments} as n
      where n.tenant_id = ${appointments.tenantId}
        and n.patient_id = ${appointments.patientId}
        and n.service_id = ${appointments.serviceId}
        and n.starts_at > ${appointments.startsAt}
        and n.status <> 'cancelled'
    )`;
    const recalls = await tx
      .select({ id: appointments.id })
      .from(appointments)
      .innerJoin(services, eq(services.id, appointments.serviceId))
      .where(
        and(
          eq(appointments.status, "completed"),
          isNotNull(services.recallAfterDays),
          sql`${appointments.startsAt} <= ${due.toISOString()}::timestamptz - make_interval(days => ${services.recallAfterDays})`,
          sql`${appointments.startsAt} >= ${due.toISOString()}::timestamptz - make_interval(days => ${services.recallAfterDays} + 30)`,
          newer,
        ),
      );
    // Membership renewals: periods ending within 3 days (Riyadh), not cancelled, not renewed,
    // and no newer membership since.
    const dueDay = riyadhDay(due);
    const memberships = await tx
      .select({ id: patientMemberships.id })
      .from(patientMemberships)
      .where(
        and(
          isNull(patientMemberships.cancelledAt),
          gte(patientMemberships.endsOn, dueDay),
          lte(patientMemberships.endsOn, addDays(dueDay, 3)),
          sql`not exists (
            select 1 from ${patientMemberships} as n
            where n.tenant_id = ${patientMemberships.tenantId}
              and n.patient_id = ${patientMemberships.patientId}
              and n.starts_on > ${patientMemberships.startsOn}
              and n.cancelled_at is null
          )`,
        ),
      );
    return { reminders, arrivals, postCare, noShows, recalls, memberships };
  });
}

/** Of these dedupe keys, the ones already sent (or deliberately skipped) before. */
async function alreadyDone(tenantId: string, keys: string[]) {
  if (!keys.length) return new Set<string>();
  const done = new Set<string>();
  for (let i = 0; i < keys.length; i += 1000) {
    const rows = await withTenant(tenantId, (tx) =>
      tx
        .select({ key: messageDispatches.dedupeKey })
        .from(messageDispatches)
        .where(inArray(messageDispatches.dedupeKey, keys.slice(i, i + 1000))),
    );
    for (const r of rows) done.add(r.key);
  }
  return done;
}

export async function runScheduledMessages(
  tenant: Tenant,
  options: RunOptions = {},
): Promise<RunSummary> {
  const started = Date.now();
  const budget = options.budgetMs ?? DEFAULT_BUDGET_MS;
  const now = options.now ?? new Date();
  const env = options.env ?? process.env;
  const summary: RunSummary = {
    quietHours: false,
    sent: {},
    skipped: {},
    failed: {},
    more: false,
  };
  if (inQuietHours(now) && !options.ignoreQuietHours) {
    summary.quietHours = true;
    return summary;
  }
  const due = new Date(now.getTime() + (options.fastForwardHours ?? 0) * HOUR);
  const work = await dueWork(tenant.id, due);
  const jobs: { kind: string; key: string; send: () => Promise<SendOutcome> }[] = [
    ...work.reminders.map((a) => ({
      kind: "reminder",
      key: SCHEDULED_KEYS.reminder(a.id, a.startsAt),
      send: () => sendReminder(tenant, a.id, env),
    })),
    ...work.arrivals.map((a) => ({
      kind: "arrival_invite",
      key: SCHEDULED_KEYS.arrival_invite(a.id, a.startsAt),
      send: () => sendArrivalInvite(tenant, a.id, env),
    })),
    ...work.postCare.map((a) => ({
      kind: "post_care",
      key: SCHEDULED_KEYS.post_care(a.id),
      send: () => sendPostCare(tenant, a.id, env),
    })),
    ...work.noShows.map((a) => ({
      kind: "no_show",
      key: SCHEDULED_KEYS.no_show(a.id),
      send: () => sendNoShowFollowUp(tenant, a.id, env),
    })),
    ...work.recalls.map((a) => ({
      kind: "recall",
      key: SCHEDULED_KEYS.recall(a.id),
      send: () => sendRecall(tenant, a.id, env),
    })),
    ...work.memberships.map((m) => ({
      kind: "membership_renewal",
      key: SCHEDULED_KEYS.membership_renewal(m.id),
      send: () => sendMembershipRenewal(tenant, m.id, env),
    })),
  ];
  const done = await alreadyDone(
    tenant.id,
    jobs.map((j) => j.key),
  );
  const todo = jobs.filter((j) => !done.has(j.key));

  const count = (kind: string, r: SendOutcome) => {
    const bucket =
      r.outcome === "sent"
        ? summary.sent
        : r.outcome === "failed"
          ? summary.failed
          : summary.skipped;
    bucket[kind] = (bucket[kind] ?? 0) + 1;
  };
  // A few at a time; no new send starts once the budget is spent (the next call continues).
  let next = 0;
  const worker = async () => {
    while (next < todo.length) {
      if (Date.now() - started > budget) {
        summary.more = true;
        return;
      }
      const job = todo[next++]!;
      count(job.kind, await job.send());
    }
  };
  await Promise.all(Array.from({ length: Math.min(SEND_CONCURRENCY, todo.length) }, worker));
  return summary;
}
