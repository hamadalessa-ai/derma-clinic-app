/**
 * Everything the Concern card shows: the chat (with who replied, photos for doctors/admins),
 * staff notes / follow-ups / resolution, and — for staff who handle concerns — what they can do.
 * Runs as the signed-in user (branch walls and RLS apply).
 */
import { and, asc, eq } from "drizzle-orm";
import { conversations, services } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import type { Actor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { riyadhDay } from "@/lib/booking/time";
import { formatTime } from "@/lib/format";
import type { ConcernEventView } from "@/components/whatsapp/chat";
import type { Locale } from "@/i18n/config";
import { concernEventsFor, followUpMode } from "./concern-actions";
import { concernThread, findConcerns, type Concern } from "./concerns";
import { insideWindow } from "./staff";
import { messageView, senderNames } from "./view";

export async function concernCards(
  tx: TenantTx,
  actor: Actor,
  opts: { patientId: string; highlight: string | null; locale: Locale },
) {
  const all = await findConcerns(tx, { patientId: opts.patientId });
  const concerns = all
    .filter((c) => c.open || c.appointmentId === opts.highlight)
    .sort(
      (a, b) =>
        Number(b.appointmentId === opts.highlight) - Number(a.appointmentId === opts.highlight),
    );
  if (!concerns.length) return [];
  const handles = can(actor.roles, "concerns:handle");
  const serviceRows = handles
    ? await tx
        .select({
          id: services.id,
          code: services.code,
          nameAr: services.nameAr,
          nameEn: services.nameEn,
        })
        .from(services)
        .where(eq(services.isActive, true))
        .orderBy(asc(services.sortOrder))
    : [];
  const today = riyadhDay(new Date());
  return Promise.all(
    concerns.map(async (concern: Concern) => {
      const [thread, eventRows, [convo]] = await Promise.all([
        concernThread(tx, concern),
        concernEventsFor(tx, { conversationId: concern.conversationId }),
        tx
          .select({ lastInboundAt: conversations.lastInboundAt })
          .from(conversations)
          .where(and(eq(conversations.id, concern.conversationId))),
      ]);
      const names = await senderNames(tx, thread, opts.locale);
      const events: ConcernEventView[] = eventRows
        .filter(({ e }) => e.appointmentId === concern.appointmentId)
        .map(({ e, name, nameEn }) => ({
          id: e.id,
          kind: e.kind as ConcernEventView["kind"],
          body: e.body,
          actorName: (opts.locale === "en" && nameEn ? nameEn : name) ?? "—",
          createdAt: e.createdAt.toISOString(),
          at: e.proposedStartsAt?.toISOString() ?? null,
        }));
      const lastIn = convo?.lastInboundAt ?? null;
      return {
        concern,
        thread: thread.map((m) =>
          messageView(m, opts.locale, { names, canSeePhotos: can(actor.roles, "photos:view") }),
        ),
        events,
        inboxHref: can(actor.roles, "whatsapp:inbox")
          ? `/whatsapp?f=all&c=${concern.conversationId}`
          : null,
        actions: handles
          ? {
              canReplyFreely: insideWindow(lastIn),
              windowEndsAt: lastIn
                ? formatTime(new Date(lastIn.getTime() + 24 * 3600_000), opts.locale)
                : null,
              followUpMode: await followUpMode(tx, actor, concern.practitionerId),
              services: serviceRows.map((s) => ({
                id: s.id,
                name: opts.locale === "en" ? s.nameEn : s.nameAr,
              })),
              defaultServiceId:
                serviceRows.find((s) => s.code === "consultation")?.id ?? concern.serviceId,
              today,
            }
          : null,
      };
    }),
  );
}
