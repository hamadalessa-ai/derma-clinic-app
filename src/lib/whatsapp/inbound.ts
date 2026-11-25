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
 *  - a photo → stored in the patient's file (FileStore), tied to their open concern;
 *  - any other text → the AI receptionist answers (src/lib/ai/receptionist.ts) when the clinic
 *    switched it on and nobody on staff took the chat over; otherwise → inbox, "needs reply";
 *  - delivery statuses (sent / delivered / read / failed) update the stored message.
 */
import { clinicIsActive } from "@/lib/tenant/status";
import { effectiveLimits } from "@/lib/platform/limits";
import { planAllows } from "@/lib/platform/plans";
import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { conversations, messages, patients, webhookEvents } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import {
  BookingError,
  cancelByPatient,
  confirmByPatient,
  rescheduleOptions,
  getAppointment,
  getSettings,
  moveByPatient,
  patientFamilyIds,
} from "@/lib/booking/engine";
import { addDays, riyadhDay } from "@/lib/booking/time";
import { doctorNames } from "@/lib/booking/doctor-names";
import { audit } from "@/lib/audit";
import { anthropicClient, type ClaudeClient } from "@/lib/ai/claude";
import { aiCanAnswer, runReceptionist } from "@/lib/ai/receptionist";
import { getFileStore } from "@/lib/files/store";
import { sendPushEvents, type PushEvent } from "@/lib/push/notify";
import { formatTime } from "@/lib/format";
import { consentSignUrl } from "@/lib/video/link";
import { selfCheckIn } from "@/lib/visits/self-check-in";
import { parseButtonPayload, type ParsedButton } from "./buttons";
import { START_WORDS, STOP_WORDS, type ReplyKind } from "./catalog";
import { appBaseUrl, clinicLiveConfig } from "./config";
import { CONCERN_OPEN_DAYS } from "./concerns";
import { downloadMetaMedia } from "./meta";
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
      /** text = typed; button = a reply button (payload = its id); image = a photo; unsupported = audio… */
      kind: "text" | "button" | "image" | "unsupported";
      /** Typed text, or a photo's caption. */
      text?: string;
      /** A photo: Meta's media id (downloaded later), or the simulator's bytes (demo only). */
      media?: { id?: string | null; mimeType?: string | null; dataBase64?: string | null };
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
  /** Tests: the moment to act at (default: now). */
  now?: Date;
  /** The AI receptionist's model client (default: from ANTHROPIC_API_KEY; null = no AI). */
  ai?: ClaudeClient | null;
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
  // The AI receptionist only works for an active clinic whose plan includes it.
  const ai =
    !clinicIsActive(tenant) || !planAllows(tenant, "aiReceptionist")
      ? null
      : options.ai === undefined
        ? anthropicClient(env)
        : options.ai;
  const results: { eventId: string; outcome: string }[] = [];
  for (const ev of events) {
    try {
      results.push({
        eventId: ev.eventId,
        outcome: await handleOne(tenant, ev, env, notify, options.now, ai),
      });
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
  now?: Date,
  ai: ClaudeClient | null = null,
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
  // A photo is fetched BEFORE the database transaction (network).
  const photo = ev.kind === "image" ? await fetchPhoto(tenant, ev, env) : null;
  let aiTurn = false;
  // Was the chat already waiting for staff BEFORE this message? (The AI keeps that flag.)
  let waitingBefore = false;
  const work = await withTenant(tenant.id, async (tx) => {
    if (!(await firstTime(tx, tenant.id, `message:${ev.eventId}`))) return null;
    const convo = await ensureConversation(tx, { phone: ev.from, profileName: ev.profileName });
    if (ev.kind === "image") {
      return {
        replies: [] as Reply[],
        push: await storePhoto(tx, tenant, convo, ev, photo, now),
        convo,
      };
    }
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
    waitingBefore = convo.needsReply;
    // Typed text the AI receptionist may answer (the chat as it was BEFORE this message decides).
    aiTurn =
      ev.kind === "text" &&
      !!text &&
      needsReply &&
      (await aiCanAnswer(tx, convo, ai, now, effectiveLimits(tenant).aiMonthly));
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
      // Flagged at once, even when the AI will answer: if the AI run is cut off (timeout, crash),
      // the chat still shows as "needs reply". The AI clears it only after its answer is sent.
      needsReply: needsReply || undefined,
    });

    if (isStop || isStart) {
      await setOptOut(tx, convo, isStop);
      return { replies: [{ kind: isStop ? "stop_ack" : "start_ack" } as Reply], push: [], convo };
    }
    if (!button) return { replies: [] as Reply[], push: [] as PushEvent[], convo };
    if (!convo.patientId) return { replies: [{ kind: "not_found" } as Reply], push: [], convo };
    const outcome = await handleButton(tx, tenant, convo.patientId, button, env, now);
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
  if (aiTurn && ai) {
    const r = await runReceptionist(tenant, work.convo.id, {
      client: ai,
      env,
      now,
      notify,
      waitingBefore,
    });
    return `ai_${r.outcome}`;
  }
  return work.replies[0]?.kind ?? "stored";
}

/** The photo's bytes: from the simulator (demo events only) or downloaded from Meta. */
async function fetchPhoto(
  tenant: Tenant,
  ev: Extract<InboundEvent, { type: "message" }>,
  env: Env,
) {
  const mimeType = ev.media?.mimeType || "image/jpeg";
  if (ev.eventId.startsWith("sim-")) {
    return ev.media?.dataBase64
      ? { data: Buffer.from(ev.media.dataBase64, "base64"), mimeType }
      : null;
  }
  const live = clinicLiveConfig(tenant, env).config;
  if (!live || live.provider !== "meta" || !ev.media?.id) return null;
  return downloadMetaMedia(live, ev.media.id);
}

/**
 * A photo from the patient: stored in their file through the FileStore (doctors and admins can
 * see it), shown in the chat, and tied to their open post-care concern (the doctor is notified).
 */
async function storePhoto(
  tx: TenantTx,
  tenant: Tenant,
  convo: { id: string; patientId: string | null },
  ev: Extract<InboundEvent, { type: "message" }>,
  photo: { data: Buffer; mimeType: string } | null,
  now = new Date(),
): Promise<PushEvent[]> {
  const [concern] = await tx
    .select({ appointmentId: messages.appointmentId })
    .from(messages)
    .where(
      and(
        eq(messages.conversationId, convo.id),
        eq(messages.flag, "concern"),
        gte(messages.createdAt, new Date(now.getTime() - CONCERN_OPEN_DAYS * 86_400_000)),
      ),
    )
    .orderBy(desc(messages.createdAt))
    .limit(1);
  let fileId: string | null = null;
  if (photo && convo.patientId) {
    try {
      fileId = (
        await getFileStore().put(
          { tx, tenantId: tenant.id, userId: null },
          { kind: "patient_photo", mimeType: photo.mimeType, data: photo.data },
        )
      ).id;
    } catch (err) {
      console.warn("whatsapp photo not stored", err); // e.g. not an image / too big
    }
  }
  const caption = (ev.text ?? "").trim();
  await recordMessage(tx, {
    conversationId: convo.id,
    patientId: convo.patientId,
    appointmentId: concern?.appointmentId ?? null,
    direction: "in",
    kind: "inbound_image",
    body: (caption || "[photo]").slice(0, 4000),
    fileId,
    channel: ev.eventId.startsWith("sim-") ? "demo" : "meta",
    status: "received",
    providerMessageId: ev.eventId.startsWith("sim-") ? null : ev.eventId,
    needsReply: true,
  });
  if (fileId) {
    await audit(tx, {
      actorUserId: null,
      action: "patient_photo.received",
      entityType: "file",
      entityId: fileId,
      metadata: {
        via: "whatsapp",
        patientId: convo.patientId,
        appointmentId: concern?.appointmentId ?? null,
      },
    });
  }
  return concern?.appointmentId
    ? [{ type: "concern_photo", appointmentId: concern.appointmentId }]
    : [];
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
/** "د. ريم الشهري" → "ريم" (fits a 20-character button with the time). */
function shortDoctor(name: string) {
  return name.replace(/^(د\.|Dr\.)\s*/, "").split(/\s+/)[0] ?? "";
}

function slotTitle(date: Date, lang: "ar" | "en", short = false) {
  const tag = lang === "ar" ? "ar-SA-u-ca-gregory-nu-latn" : "en-GB";
  const f = (o: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat(tag, { timeZone: "Asia/Riyadh", ...o }).format(date);
  const time = f({ hour: "2-digit", minute: "2-digit", hour12: false });
  if (short) return `${f({ day: "2-digit", month: "2-digit" })} ${time}`;
  return `${f({ weekday: "short" })} ${f({ day: "2-digit", month: "2-digit" })} ${time}`.slice(
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
  now: Date = new Date(),
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
        cancelByPatient(tx, { patientId, appointmentId: apptId, via: "whatsapp", now }),
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
      // The same rules as the patient page (rescheduleOptions): the appointment never blocks its
      // own new time; if the doctor is full, other doctors are offered; refusals are explained.
      const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
      const lang = p?.preferredLanguage === "en" ? "en" : "ar";
      const same: Date[] = [];
      const others: { startsAt: Date; practitionerId: string }[] = [];
      const today = riyadhDay(now);
      for (let d = 0; d <= settings.onlineHorizonDays && same.length < 3; d++) {
        const r = await rescheduleOptions(tx, {
          appointmentId: apptId,
          day: addDays(today, d),
          patientId,
          now,
        });
        if (!r.ok) {
          if (r.reason === "too_soon" || r.reason === "closed") continue;
          if (r.reason === "too_far") break;
          if (r.reason === "outside_window") {
            return {
              replies: [{ kind: "change_too_late", vars: { hours }, appointmentId: apptId }],
              push: [],
            };
          }
          return {
            replies: [
              {
                kind: "reschedule_unavailable",
                vars: { my_link: `${base}/my` },
                appointmentId: apptId,
              },
            ],
            push: [],
          };
        }
        same.push(...r.sameDoctor.slice(0, 3 - same.length).map((x) => x.startsAt));
        for (const o of r.otherDoctors) {
          for (const x of o.slots) {
            if (
              others.length < 3 &&
              !others.some((y) => y.startsAt.getTime() === x.startsAt.getTime())
            ) {
              others.push({ startsAt: x.startsAt, practitionerId: o.practitionerId });
            }
          }
        }
      }
      const appt = await getAppointment(tx, apptId);
      const names = await doctorNames(tx, [
        appt.practitionerId,
        ...others.map((o) => o.practitionerId),
      ]);
      const nameOf = (id: string) => {
        const n = names.get(id);
        return n ? (lang === "en" && n.nameEn ? n.nameEn : n.nameAr) : "";
      };
      if (same.length) {
        return {
          replies: [
            {
              kind: "reschedule_offer",
              appointmentId: apptId,
              vars: { my_link: `${base}/my` },
              buttons: same.map((x) => ({
                action: "slot",
                appointmentId: apptId,
                extra: String(Math.round(x.getTime() / 60_000)),
                title: slotTitle(x, lang),
              })),
            },
          ],
          push: [],
        };
      }
      if (others.length) {
        return {
          replies: [
            {
              kind: "reschedule_offer_other",
              appointmentId: apptId,
              vars: { doctor: nameOf(appt.practitionerId), my_link: `${base}/my` },
              buttons: others.map((x) => ({
                action: "slot",
                appointmentId: apptId,
                extra: `${Math.round(x.startsAt.getTime() / 60_000)}-${x.practitionerId}`,
                title:
                  `${shortDoctor(nameOf(x.practitionerId))} ${slotTitle(x.startsAt, lang, true)}`.slice(
                    0,
                    20,
                  ),
              })),
            },
          ],
          push: [],
        };
      }
      return {
        replies: [
          {
            kind: "reschedule_none",
            appointmentId: apptId,
            vars: { doctor: nameOf(appt.practitionerId), my_link: `${base}/my` },
          },
        ],
        push: [],
      };
    }
    case "slot": {
      // extra = "<minutes>" (same doctor) or "<minutes>-<doctor id>" (another doctor).
      const dash = (button.extra ?? "").indexOf("-");
      const minutes = dash === -1 ? button.extra : button.extra!.slice(0, dash);
      const otherDoctor = dash === -1 ? undefined : button.extra!.slice(dash + 1);
      const startsAt = new Date(Number(minutes) * 60_000);
      const r = await run(() =>
        moveByPatient(tx, {
          patientId,
          appointmentId: apptId,
          startsAt,
          practitionerId: otherDoctor,
          via: "whatsapp",
          now,
        }),
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
    case "arrived": {
      // Self check-in from the visit-day message (window, consent and package steps inside).
      const r = await run(() =>
        selfCheckIn(tx, {
          tenantId: tenant.id,
          appointmentId: apptId,
          patientIds: [target.patientId],
          via: "whatsapp",
          now,
        }),
      );
      if (!r.ok) return { replies: [{ kind: "arrival_desk", appointmentId: apptId }], push: [] };
      const res = r.value;
      if (res.status === "checked_in") {
        return {
          replies: [{ kind: "checked_in_ack", appointmentId: apptId }],
          push: [{ type: "checked_in", appointmentId: apptId }],
        };
      }
      if (res.status === "already_checked_in") {
        return { replies: [{ kind: "checked_in_ack", appointmentId: apptId }], push: [] };
      }
      if (res.status === "consent_required") {
        return {
          replies: [
            {
              kind: "arrival_consent",
              appointmentId: apptId,
              vars: { sign_link: consentSignUrl(base, tenant.id, apptId) },
            },
          ],
          push: [],
        };
      }
      if (res.status === "too_early") {
        const [p] = await tx.select().from(patients).where(eq(patients.id, patientId));
        const lang = p?.preferredLanguage === "en" ? "en" : "ar";
        return {
          replies: [
            {
              kind: "arrival_too_early",
              appointmentId: apptId,
              vars: { minutes: String(res.beforeMinutes), time: formatTime(res.startsAt, lang) },
            },
          ],
          push: [],
        };
      }
      return { replies: [{ kind: "arrival_desk", appointmentId: apptId }], push: [] };
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
