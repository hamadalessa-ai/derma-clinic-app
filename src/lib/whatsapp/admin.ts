/**
 * Clinic admin: switch message types on/off and edit their wording (Arabic + English),
 * per-service texts (pre-visit, post-care, recall), "Run scheduled messages now" (demo),
 * and "Send test message" (live).
 */
import { eq } from "drizzle-orm";
import { messageTemplates, services } from "@/db/schema";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { TEMPLATES, unknownPlaceholders, type TemplateKind } from "./catalog";
import { liveConfig, whatsappMode } from "./config";
import { runScheduledMessages } from "./scheduler";
import type { Tenant } from "./send";
import { ensureConversation, recordMessage } from "./store";
import { liveTransport } from "./transport";
import { withTenant } from "@/db/tenant";

export class TemplateError extends Error {
  constructor(
    public code: "unknown_placeholder" | "empty_text" | "cannot_disable",
    public detail: string[] = [],
  ) {
    super(code);
    this.name = "TemplateError";
  }
}

export async function updateTemplate(
  tx: TenantTx,
  actor: Actor,
  input: { kind: TemplateKind; enabled: boolean; bodyAr: string; bodyEn: string },
) {
  assertCan(actor.roles, "whatsapp:manage");
  const bodyAr = input.bodyAr.trim();
  const bodyEn = input.bodyEn.trim();
  if (!bodyAr || !bodyEn) throw new TemplateError("empty_text");
  const unknown = [
    ...unknownPlaceholders(input.kind, bodyAr),
    ...unknownPlaceholders(input.kind, bodyEn),
  ];
  if (unknown.length) throw new TemplateError("unknown_placeholder", [...new Set(unknown)]);
  if (!input.enabled && !TEMPLATES[input.kind].canDisable)
    throw new TemplateError("cannot_disable");
  await tx
    .insert(messageTemplates)
    .values({
      tenantId: actor.tenantId,
      kind: input.kind,
      enabled: input.enabled,
      bodyAr,
      bodyEn,
      metaName: TEMPLATES[input.kind].metaName,
    })
    .onConflictDoUpdate({
      target: [messageTemplates.tenantId, messageTemplates.kind],
      set: { enabled: input.enabled, bodyAr, bodyEn },
    });
  await audit(tx, {
    actorUserId: actor.userId,
    action: "whatsapp.template_update",
    entityType: "message_template",
    metadata: { kind: input.kind, enabled: input.enabled },
  });
}

export async function updateServiceTexts(
  tx: TenantTx,
  actor: Actor,
  input: {
    serviceId: string;
    preVisitAr: string;
    preVisitEn: string;
    postCareAr: string;
    postCareEn: string;
    recallAfterDays: number | null;
  },
) {
  assertCan(actor.roles, "whatsapp:manage");
  const clean = (v: string) => v.trim() || null;
  const [row] = await tx
    .update(services)
    .set({
      preVisitAr: clean(input.preVisitAr),
      preVisitEn: clean(input.preVisitEn),
      postCareAr: clean(input.postCareAr),
      postCareEn: clean(input.postCareEn),
      recallAfterDays: input.recallAfterDays,
    })
    .where(eq(services.id, input.serviceId))
    .returning({ id: services.id });
  if (!row) return null;
  await audit(tx, {
    actorUserId: actor.userId,
    action: "service.whatsapp_texts",
    entityType: "service",
    entityId: input.serviceId,
    metadata: { recallAfterDays: input.recallAfterDays },
  });
  return row;
}

/** Demo only: the admin runs the scheduler now (optionally fast-forward 24 h / ignore quiet hours). */
export async function runScheduledNow(
  tenant: Tenant,
  actor: Actor,
  options: { fastForward: boolean; ignoreQuietHours: boolean },
) {
  assertCan(actor.roles, "whatsapp:manage");
  if (whatsappMode(tenant) !== "demo") return null;
  const summary = await runScheduledMessages(tenant, {
    fastForwardHours: options.fastForward ? 24 : 0,
    ignoreQuietHours: options.ignoreQuietHours,
  });
  await withTenant(tenant.id, (tx) =>
    audit(tx, {
      actorUserId: actor.userId,
      action: "whatsapp.run_now",
      entityType: "tenant",
      entityId: tenant.id,
      metadata: { ...options, sent: summary.sent },
    }),
  );
  return summary;
}

/**
 * Live only: Meta's standard "hello_world" test template (every WhatsApp account has it), so a test
 * works even outside the 24-hour window. The result (and any error code) is stored like any message.
 */
export async function sendTestMessage(tenant: Tenant, actor: Actor, phone: string) {
  assertCan(actor.roles, "whatsapp:manage");
  const { config } = liveConfig();
  if (!config || whatsappMode(tenant) !== "live")
    return { ok: false as const, errorCode: "not_live" };
  const result = await liveTransport(config).send({
    to: phone,
    language: "en_US",
    body: "hello_world (Meta test template)",
    buttons: [],
    template: { name: "hello_world", params: [] },
    insideWindow: false,
  });
  await withTenant(tenant.id, async (tx) => {
    const convo = await ensureConversation(tx, { phone });
    await recordMessage(tx, {
      conversationId: convo.id,
      patientId: convo.patientId,
      direction: "out",
      kind: "test",
      body: "hello_world (Meta test template)",
      channel: config.provider,
      status: result.ok ? "sent" : "failed",
      providerMessageId: result.ok ? result.providerMessageId : null,
      errorCode: result.ok ? null : result.errorCode,
      errorText: result.ok ? null : result.errorText,
      templateName: "hello_world",
      sentBy: actor.userId,
    });
    await audit(tx, {
      actorUserId: actor.userId,
      action: "whatsapp.test_message",
      entityType: "conversation",
      entityId: convo.id,
      metadata: { ok: result.ok },
    });
  });
  return result;
}
