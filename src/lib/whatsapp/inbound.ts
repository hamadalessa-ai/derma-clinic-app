/**
 * The ONE handler for everything patients send by WhatsApp — real webhooks from Meta AND taps or
 * typing in the demo simulator go through handleInbound(), so the logic is identical.
 *
 *  - repeated deliveries are handled once (webhook_events);
 *  - the number is matched to a patient in this clinic; unknown numbers become a new contact
 *    ("not a patient yet") in the inbox — never dropped;
 *  - buttons (signed payloads) confirm / cancel / reschedule through the booking engine;
 *  - STOP / إيقاف opts out, START / تفعيل opts back in;
 *  - post-care "concern" → flagged in the inbox + push to the doctor and reception;
 *  - any other text → inbox, "needs reply" (Phase 2c: the AI receptionist plugs in here);
 *  - delivery statuses (sent / delivered / read / failed) update the stored message.
 */
import { eq, inArray, sql } from "drizzle-orm";
import { conversations, messages, patients, webhookEvents } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import {
  BookingError,
  cancelByPatient,
  confirmByPatient,
  findOnlineSlots,
  getAppointment,
  getSettings,
  moveByPatient,
  patientFamilyIds,
} from "@/lib/booking/engine";
import { addDays, riyadhDay } from "@/lib/booking/time";
import { sendPushEvents, type PushEvent } from "@/lib/push/notify";
import { parseButtonPayload, type ParsedButton } from "./buttons";
import { START_WORDS, STOP_WORDS, type ReplyKind } from "./catalog";
import { appBaseUrl } from "./config";
import { appointmentVars, loadAppointmentContext } from "./compose";
import { sendMessage, type ButtonSpec, type Tenant } from "./send";
import { ensureConversation, recordMessage } from "./store";

type Env = Record<string, string | undefined>;

export type InboundEvent =
  | {
      type: "message";
      /** Provider message id (wamid…), or "sim-…" from the simulator. Used to skip repeats. */
      eventId: string;
      from: string; // 05XXXXXXXX
      profileName?: string | null;
      /** text = typed; button = a reply button (payload = its id); unsupported = image, audio… */
      kind: "text" | "button" | "unsupported";
      text?: string;
      buttonPayload?: string;
      buttonTitle?: string;
      unsupportedType?: string;
    }
  | {
      type: "status";
      eventId: string;
      providerMessageId: string;
      status: "sent" | "delivered" | "read" | "failed";
      errorCode?: string | null;
      errorText?: string | null;
    };

export interface InboundOptions {
  env?: Env;
  /** Push notifications (default: send them now). Tests can collect them instead. */
  notify?: (events: PushEvent[]) => Promise<unknown>;
}

const STATUS_RANK: Record<string, number> = { queued: 0, sent: 1, delivered: 2, read: 3 };

type Reply = {
  kind: ReplyKind;
  vars?: Record<string, string>;
  buttons?: ButtonSpec[];
  appointmentId?: string | null;
};

/** Claims an event id; false when it was already handled (Meta sometimes delivers twice). */
async function firstTime(tx: TenantTx, tenantId: string, key: string) {
  const rows = await tx
    .insert(webhookEvents)
    .values({ tenantId, eventKey: key.slice(0, 200) })
    .onConflictDoNothing()
    .returning({ id: webhookEvents.id });
  return rows.length > 0;
}

export async function handleInbound(
  tenant: Tenant,
  events: InboundEvent[],
  options: InboundOptions = {},
) {
  const env = options.env ?? process.env;
  const notify = options.notify ?? ((e: PushEvent[]) => sendPushEvents(tenant.id, e, env));
  const results: { eventId: string; outcome: string }[] = [];
  for (const ev of events) {
    try {
      results.push({ eventId: ev.eventId, outcome: await handleOne(tenant, ev, env, notify) });
    } catch (err) {
      // Never crash the webhook: log and move on (Meta would otherwise retry for days).
      console.warn("whatsapp inbound failed", ev.type, err);
      results.push({ eventId: ev.eventId, outcome: "error" });
    }
  }
  return results;
}

async function handleOne(
  tenant: Tenant,
  ev: InboundEvent,
  env: Env,
  notify: (e: PushEvent[]) => Promise<unknown>,
): Promise<string> {
  if (ev.type === "status") {
    return withTenant(tenant.id, async (tx) => {
      if (!(await firstTime(tx, tenant.id, `status:${ev.providerMessageId}:${ev.status}`))) {
        return "duplicate";
      }
      const [msg] = await tx
        .select()
        .from(messages)
        .where(eq(messages.providerMessageId, ev.providerMessageId))
        .limit(1);
      if (!msg) return "unknown_message";
      // Only move forward (read never goes back to delivered); failures always win.
      if (
        ev.status !== "failed" &&
        (STATUS_RANK[ev.status] ?? 0) <= (STATUS_RANK[msg.status] ?? -1)
      ) {
        return "ignored";
      }
      await tx
        .update(messages)
        .set({
          status: ev.status,
          statusAt: sql`now()`,
          ...(ev.status === "failed"
            ? { errorCode: ev.errorCode ?? null, errorText: ev.errorText?.slice(0, 500) ?? null }
            : {}),
        })
        .where(eq(messages.id, msg.id));
      return `status_${ev.status}`;
    });
  }

  // ── An incoming message ──
  const work = await withTenant(tenant.id, async (tx) => {
    if (!(await firstTime(tx, tenant.id, `message:${ev.eventId}`))) return null;
    const convo = await ensureConversation(tx, { phone: ev.from, profileName: ev.profileName });
    const button =
      ev.kind === "button" && ev.buttonPayload
        ? parseButtonPayload(tenant.id, ev.buttonPayload, env)
        : null;
    const text = (ev.text ?? "").trim();
    const word = text.toLowerCase();
    const isStop = ev.kind === "text" && STOP_WORDS.includes(word);
    const isStart = ev.kind === "text" && START_WORDS.includes(word);
    const body =
      ev.kind === "button"
        ? (ev.buttonTitle ?? "[button]")
        : ev.kind === "unsupported"
          ? `[${ev.unsupportedType ?? "unsupported"}]`
          : text || "[empty]";
    // Free text, unknown buttons and new numbers need a human; handled taps don't.
    const needsReply = (ev.kind !== "button" || !button) && !isStop && !isStart;
    await recordMessage(tx, {
      conversationId: convo.id,
      patientId: convo.patientId,
      appointmentId: button?.appointmentId ?? null,
      direction: "in",
      kind:
        ev.kind === "button"
          ? "inbound_button"
          : ev.kind === "unsupported"
            ? "inbound_unsupported"
            : "inbound_text",
      body: body.slice(0, 4000),
      buttonId: button?.action ?? null,
      flag: button?.action === "concern" ? "concern" : null,
      channel: ev.eventId.startsWith("sim-") ? "demo" : "meta",
      status: "received",
      providerMessageId: ev.eventId.startsWith("sim-") ? null : ev.eventId,
      needsReply: needsReply || undefined,
    });

    if (isStop || isStart) {
      await setOptOut(tx, convo, isStop);
      return { replies: [{ kind: isStop ? "stop_ack" : "start_ack" } as Reply], push: [], convo };
    }
    if (!button) return { replies: [] as Reply[], push: [] as PushEvent[], convo };
    if (!convo.patientId) return { replies: [{ kind: "not_found" } as Reply], push: [], convo };
    const outcome = await handleButton(tx, tenant, convo.patientId, button, env);
    if (outcome.needsReply) {
      await tx
        .update(conversations)
        .set({ needsReply: true })
        .where(eq(conversations.id, convo.id));
    }
    return { ...outcome, convo };
  });
  if (!work) return "duplicate";

  // Replies go out after the change is saved (always inside the 24-hour window: they just wrote).
  for (const r of work.replies) {
    await sendMessage(
      tenant,
      {
        kind: r.kind,
        phone: ev.from,
        patientId: work.convo.patientId,
        appointmentId: r.appointmentId ?? null,
        vars: r.vars ?? {},
        buttons: r.buttons,
      },
      env,
    );
  }
  if (work.push.length) await notify(work.push);
  return work.replies[0]?.kind ?? "stored";
}

async function setOptOut(
  tx: TenantTx,
  convo: { id: string; patientId: string | null },
  stop: boolean,
) {
  await tx
    .update(conversations)
    .set({ optedOutAt: stop ? sql`now()` : null, needsReply: false })
    .where(eq(conversations.id, convo.id));
  if (!convo.patientId) return;
  // The whole family on that number stops (they share the phone).
  const family = await patientFamilyIds(tx, convo.patientId);
  await tx
    .update(patients)
    .set(
      stop
        ? { whatsappOptedOutAt: sql`now()` }
        : {
            whatsappOptedOutAt: null,
            whatsappOptInAt: sql`now()`,
            whatsappOptInSource: "whatsapp",
          },
    )
    .where(inArray(patients.id, family));
}

/** Weekday dd/MM HH:mm in Riyadh, short enough for a WhatsApp button (max 20 characters). */
function slotTitle(date: Date, lang: "ar" | "en") {
  const tag = lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { timeZone: "Asia/Riyadh", ...o }).format(date);
  return `${f({ weekday: "short" })} ${f({ day: "2-digit", month: "2-digit" })} ${f({ hour: "2-digit", minute: "2-digit", hour12: false })}`.slice(
    0,
    20,
  );
}

async function handleButton(
  tx: TenantTx,
  tenant: Tenant,
  patientId: string,
  button: ParsedButton,
  env: Env,
): Promise<{ replies: Reply[]; push: PushEvent[]; needsReply?: boolean }> {
  const apptId = button.appointmentId;
  if (!apptId) return { replies: [{ kind: "not_found" }], push: [] };
  // The appointment must belong to the person writing (or a child they are guardian of).
  const target = await getAppointment(tx, apptId).catch(() => null);
  if (!target || !(await patientFamilyIds(tx, patientId)).includes(target.patientId)) {
    return { replies: [{ kind: "not_found" }], push: [] };
  }
  const settings = await getSettings(tx);
  const hours = String(settings.cancellationWindowHours);
  const base = appBaseUrl(tenant, env);
  const run = async <T>(fn: () => Promise<T>) => {
    // A refused change must not undo the stored message: try it in a savepoint.
    try {
      return { ok: true as const, value: await tx.transaction(() => fn()) };
    } catch (err) {
      if (err instanceof BookingError) return { ok: false as const, code: err.code };
      throw err;
    }
  };

  switch (button.action) {
    case "confirm": {
      const r = await run(() =>
        confirmByPatient(tx, { patientId, appointmentId: apptId, via: "whatsapp" }),
      );
      return {
        replies: [{ kind: r.ok ? "confirm_ack" : "not_found", appointmentId: apptId }],
        push: [],
      };
    }
    case "cancel": {
      const r = await run(() =>
        cancelByPatient(tx, { patientId, appointmentId: apptId, via: "whatsapp" }),
      );
      if (r.ok) {
        return {
          replies: [
            { kind: "cancel_ack", appointmentId: apptId, vars: { booking_link: `${base}/book` } },
          ],
          push: [
            { type: "cancelled", appointmentId: apptId },
            { type: "patient_cancelled", appointmentId: apptId },
          ],
        };
      }
      return {
        replies: [
          {
            kind: r.code === "outside_window" ? "cancel_too_late" : "not_found",
            vars: { hours },
            appointmentId: apptId,
          },
        ],
        push: [],
      };
    }
    case "reschedule": {
      const appt = await getAppointment(tx, apptId);
      if (appt.startsAt.getTime() - Date.now() < settings.cancellationWindowHours * 3600_000) {
        return {
          replies: [{ kind: "change_too_late", vars: { hours }, appointmentId: apptId }],
          push: [],
        };
      }
      // The next 3 free times with the same doctor (online rules: notice, horizon, hours).
      const slots: Date[] = [];
      const today = riyadhDay(new Date());
      for (let d = 0; d <= settings.onlineHorizonDays && slots.length < 3; d++) {
        const found = await run(() =>
          findOnlineSlots(tx, {
            branchId: appt.branchId,
            serviceId: appt.serviceId,
            practitionerId: appt.practitionerId,
            day: addDays(today, d),
          }),
        );
        if (!found.ok) break;
        for (const s of found.value) {
          if (slots.length < 3 && s.startsAt.getTime() !== appt.startsAt.getTime())
            slots.push(s.startsAt);
        }
      }
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      const lang = p?.preferredLanguage === "en" ? "en" : "ar";
      return {
        replies: [
          {
            kind: "reschedule_offer",
            appointmentId: apptId,
            vars: { my_link: `${base}/my` },
            buttons: slots.map((s) => ({
              action: "slot",
              appointmentId: apptId,
              extra: String(Math.round(s.getTime() / 60_000)),
              title: slotTitle(s, lang),
            })),
          },
        ],
        push: [],
      };
    }
    case "slot": {
      const startsAt = new Date(Number(button.extra) * 60_000);
      const r = await run(() =>
        moveByPatient(tx, { patientId, appointmentId: apptId, startsAt, via: "whatsapp" }),
      );
      if (!r.ok) {
        return {
          replies: [
            {
              kind: r.code === "outside_window" ? "change_too_late" : "reschedule_failed",
              appointmentId: apptId,
              vars: { hours, my_link: `${base}/my` },
            },
          ],
          push: [],
        };
      }
      const ctx = await loadAppointmentContext(tx, apptId);
      const vars = ctx
        ? appointmentVars(ctx, ctx.patient.preferredLanguage === "en" ? "en" : "ar", base)
        : {};
      return {
        replies: [{ kind: "reschedule_done", appointmentId: apptId, vars }],
        push: [
          { type: "rescheduled", appointmentId: apptId },
          { type: "patient_rescheduled", appointmentId: apptId },
        ],
      };
    }
    case "all_good":
      return { replies: [{ kind: "all_good_ack", appointmentId: apptId }], push: [] };
    case "concern":
      return {
        replies: [{ kind: "concern_ack", appointmentId: apptId }],
        push: [{ type: "patient_concern", appointmentId: apptId }],
        needsReply: true,
      };
    default:
      return { replies: [], push: [], needsReply: true };
  }
}
