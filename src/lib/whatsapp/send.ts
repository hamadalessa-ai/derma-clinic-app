/**
 * Sending a WhatsApp message — the ONE path every message takes (demo simulator or real WhatsApp).
 *
 *  1. prepare (inside a clinic transaction):
 *     - "already sent?" — with a dedupe key, an insert into message_dispatches claims it; a second
 *       run (or a run at the same moment) finds the key taken and sends nothing;
 *     - consent: only verification codes and direct replies go to people who didn't opt in / sent STOP;
 *     - the type must be switched on; wording in the patient's language;
 *     - the message is stored as "queued".
 *  2. deliver (after the transaction is saved): the transport sends it, the status is updated.
 * Storing first means a crash between the two can never cause a second send ("at most once").
 */
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { messageDispatches, messages, messageTemplates, patients } from "@/db/schema";
import { withTenant, type TenantTx } from "@/db/tenant";
import {
  BUTTON_TITLES,
  ESSENTIAL_KINDS,
  fill,
  REPLIES,
  TEMPLATE_KINDS,
  TEMPLATES,
  type ButtonAction,
  type ReplyKind,
  type TemplateKind,
} from "./catalog";
import { buttonPayload } from "./buttons";
import { liveConfig, whatsappMode } from "./config";
import { ensureConversation, recordMessage } from "./store";
import {
  demoTransport,
  liveTransport,
  type OutgoingWhatsApp,
  type WhatsAppTransport,
} from "./transport";

type Env = Record<string, string | undefined>;
export type Tenant = { id: string; slug: string; isDemo: boolean };
export type MessageKind = TemplateKind | ReplyKind;

export interface ButtonSpec {
  action: ButtonAction;
  appointmentId?: string | null;
  extra?: string | null;
  /** Needed for "slot" buttons (e.g. "Sun 10:30"); others use the standard titles. */
  title?: string;
}

export interface SendInput {
  kind: MessageKind;
  /** Who: a patient (their phone is used) or just a phone number (e.g. a new contact). */
  patientId?: string | null;
  phone?: string;
  appointmentId?: string | null;
  vars?: Record<string, string>;
  buttons?: ButtonSpec[];
  /** Staff free-text reply (kind "staff_reply"). */
  text?: string;
  /** Secret placeholder values (codes): shown in the demo simulator, never stored for real sends. */
  secrets?: Record<string, string>;
  /** Scheduled messages: "reminder:<appointment>" etc. Same key = sent at most once. */
  dedupeKey?: string;
  sentBy?: string | null;
}

export type Prepared =
  | {
      outcome: "skipped";
      reason: "not_configured" | "duplicate" | "no_consent" | "disabled" | "no_phone";
    }
  | {
      outcome: "ready";
      messageId: string;
      conversationId: string;
      outgoing: OutgoingWhatsApp;
      transport: WhatsAppTransport;
    };

function transportFor(tenant: Tenant, env: Env): WhatsAppTransport | null {
  const mode = whatsappMode(tenant, env);
  if (mode === "demo") return demoTransport;
  if (mode === "live") return liveTransport(liveConfig(env).config!);
  return null;
}

const isTemplateKind = (k: string): k is TemplateKind =>
  (TEMPLATE_KINDS as readonly string[]).includes(k);

export async function prepareMessage(
  tx: TenantTx,
  tenant: Tenant,
  input: SendInput,
  env: Env = process.env,
): Promise<Prepared> {
  const transport = transportFor(tenant, env);
  if (!transport) return { outcome: "skipped", reason: "not_configured" };

  const [patient] = input.patientId
    ? await tx.select().from(patients).where(eq(patients.id, input.patientId)).limit(1)
    : [];
  const phone = input.phone ?? patient?.phone;
  if (!phone) return { outcome: "skipped", reason: "no_phone" };

  const messageId = randomUUID();
  // Claim the dedupe key first: a duplicate run stops here.
  const claim = async (outcome: string) => {
    if (!input.dedupeKey) return true;
    const rows = await tx
      .insert(messageDispatches)
      .values({
        tenantId: tenant.id,
        dedupeKey: input.dedupeKey,
        kind: input.kind,
        appointmentId: input.appointmentId ?? null,
        patientId: patient?.id ?? null,
        messageId: outcome === "sent" ? messageId : null,
        outcome,
      })
      .onConflictDoNothing()
      .returning({ id: messageDispatches.id });
    return rows.length > 0;
  };

  const convo = await ensureConversation(tx, { phone });
  const essential = ESSENTIAL_KINDS.includes(input.kind);
  const consentHolder = patient ?? null;
  const consented =
    !!consentHolder?.whatsappOptInAt && !consentHolder.whatsappOptedOutAt && !convo.optedOutAt;
  if (!essential && !consented) {
    return (await claim("skipped_no_consent"))
      ? { outcome: "skipped", reason: "no_consent" }
      : { outcome: "skipped", reason: "duplicate" };
  }

  let wording: { ar: string; en: string };
  if (isTemplateKind(input.kind)) {
    const [row] = await tx
      .select()
      .from(messageTemplates)
      .where(eq(messageTemplates.kind, input.kind))
      .limit(1);
    if (row && !row.enabled && TEMPLATES[input.kind].canDisable) {
      return (await claim("skipped_disabled"))
        ? { outcome: "skipped", reason: "disabled" }
        : { outcome: "skipped", reason: "duplicate" };
    }
    wording = row
      ? { ar: row.bodyAr, en: row.bodyEn }
      : { ar: TEMPLATES[input.kind].bodyAr, en: TEMPLATES[input.kind].bodyEn };
  } else if (input.kind === "staff_reply") {
    wording = { ar: input.text ?? "", en: input.text ?? "" };
  } else {
    wording = REPLIES[input.kind];
  }
  if (!(await claim("sent"))) return { outcome: "skipped", reason: "duplicate" };

  const lang: "ar" | "en" = patient?.preferredLanguage === "en" ? "en" : "ar";
  const vars = { ...(input.vars ?? {}) };
  const shown = fill(wording[lang], { ...vars, ...(input.secrets ?? {}) });
  const stored =
    transport.channel === "demo"
      ? shown // the simulator shows it (demo clinics only)
      : fill(wording[lang], {
          ...vars,
          ...Object.fromEntries(Object.keys(input.secrets ?? {}).map((k) => [k, "******"])),
        });
  const buttons = (input.buttons ?? []).map((b) => ({
    id: buttonPayload(tenant.id, b.action, b.appointmentId ?? null, b.extra ?? null, env),
    title:
      b.title ??
      (b.action in BUTTON_TITLES
        ? BUTTON_TITLES[b.action as keyof typeof BUTTON_TITLES][lang]
        : b.action),
  }));
  const insideWindow =
    !!convo.lastInboundAt && convo.lastInboundAt.getTime() > Date.now() - 24 * 3600_000;
  const template = isTemplateKind(input.kind)
    ? {
        name: TEMPLATES[input.kind].metaName,
        params: TEMPLATES[input.kind].variables.map((v) =>
          v in (input.secrets ?? {}) ? input.secrets![v] : (vars[v] ?? ""),
        ),
      }
    : null;

  await recordMessage(tx, {
    id: messageId,
    conversationId: convo.id,
    patientId: patient?.id ?? convo.patientId,
    appointmentId: input.appointmentId ?? null,
    direction: "out",
    kind: input.kind,
    body: stored,
    buttons: buttons.length ? buttons : null,
    channel: transport.channel,
    status: "queued",
    templateName: template && !insideWindow ? template.name : null,
    language: lang,
    sentBy: input.sentBy ?? null,
  });

  return {
    outcome: "ready",
    messageId,
    conversationId: convo.id,
    transport,
    outgoing: { to: phone, language: lang, body: shown, buttons, template, insideWindow },
  };
}

/** Sends a prepared message and stores the result (sent / delivered / failed + error). */
export async function deliverMessage(tx: TenantTx, prepared: Prepared) {
  if (prepared.outcome !== "ready") return prepared;
  const result = await prepared.transport.send(prepared.outgoing);
  const demo = prepared.transport.channel === "demo";
  await tx
    .update(messages)
    .set(
      result.ok
        ? {
            status: demo ? "delivered" : "sent",
            providerMessageId: result.providerMessageId,
            statusAt: sql`now()`,
          }
        : {
            status: "failed",
            errorCode: result.errorCode,
            errorText: result.errorText,
            statusAt: sql`now()`,
          },
    )
    .where(and(eq(messages.id, prepared.messageId)));
  return {
    outcome: result.ok ? ("sent" as const) : ("failed" as const),
    messageId: prepared.messageId,
    error: result.ok ? null : result.errorCode,
  };
}

export type SendOutcome =
  | { outcome: "skipped"; reason: string }
  | { outcome: "sent" | "failed"; messageId: string; error: string | null };

/**
 * Prepare in one transaction (committed), deliver after it, status in another. Use this for
 * everything except calls already inside a transaction that must include the send (codes).
 */
export async function sendMessage(
  tenant: Tenant,
  input: SendInput,
  env: Env = process.env,
): Promise<SendOutcome> {
  const prepared = await withTenant(tenant.id, (tx) => prepareMessage(tx, tenant, input, env));
  if (prepared.outcome !== "ready") return prepared;
  const result = await prepared.transport.send(prepared.outgoing);
  await withTenant(tenant.id, (tx) =>
    tx
      .update(messages)
      .set(
        result.ok
          ? {
              status: prepared.transport.channel === "demo" ? "delivered" : "sent",
              providerMessageId: result.providerMessageId,
              statusAt: sql`now()`,
            }
          : {
              status: "failed",
              errorCode: result.errorCode,
              errorText: result.errorText,
              statusAt: sql`now()`,
            },
      )
      .where(eq(messages.id, prepared.messageId)),
  );
  return result.ok
    ? { outcome: "sent", messageId: prepared.messageId, error: null }
    : { outcome: "failed", messageId: prepared.messageId, error: result.errorCode };
}

/** Inside an existing transaction (verification codes): prepare + send + status together. */
export async function sendInTransaction(
  tx: TenantTx,
  tenant: Tenant,
  input: SendInput,
  env: Env = process.env,
): Promise<SendOutcome> {
  const prepared = await prepareMessage(tx, tenant, input, env);
  if (prepared.outcome !== "ready") return prepared;
  return deliverMessage(tx, prepared);
}
