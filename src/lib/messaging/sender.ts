/**
 * Messages to patients (verification codes, booking confirmations) go through a MessageSender.
 * Phase 2a has only the DEMO sender: it writes the message to outbound_messages (and the server
 * log) and sends nothing. WhatsApp / SMS senders plug in here later (Phase 2b).
 *
 * DEMO SAFETY: the demo sender (and showing a code on screen) is allowed ONLY when
 *   the clinic is a demo clinic (tenants.is_demo)  AND  the environment says MESSAGE_DEMO_MODE=on.
 * A real clinic never gets the demo sender, even with the flag on. If no real sender is configured,
 * getMessageSender() returns null and verification fails safely with "messaging_unavailable".
 */
import type { TenantTx } from "@/db/tenant";
import { maskPhone } from "@/lib/phone";
import { fill } from "@/lib/whatsapp/catalog";
import { ensureConversation, recordMessage } from "@/lib/whatsapp/store";

export interface OutboundMessage {
  to: string; // 05XXXXXXXX
  template: string; // e.g. "booking_code", "portal_code"
  /** Text with placeholders, e.g. "Your code: {code}". */
  body: string;
  /** Secret values for the placeholders. Real senders fill them in; the log NEVER stores them. */
  secrets?: Record<string, string>;
}

/** The text as it may be stored: secret placeholders replaced by ******. */
export function redacted(msg: OutboundMessage): string {
  return msg.body.replace(/\{(\w+)\}/g, (m, k: string) =>
    msg.secrets && k in msg.secrets ? "******" : m,
  );
}

export interface MessageSender {
  readonly channel: "demo" | "whatsapp" | "sms";
  /** True only for the demo sender: the screen may show the message (e.g. the code) itself. */
  readonly showsOnScreen: boolean;
  send(tx: TenantTx, msg: OutboundMessage): Promise<void>;
}

export class MessagingUnavailableError extends Error {
  code = "messaging_unavailable" as const;
  constructor() {
    super("No message sender is configured for this clinic");
    this.name = "MessagingUnavailableError";
  }
}

/** Is demo mode switched on for this clinic? Both conditions are required. */
export function demoMessagingAllowed(
  tenant: { isDemo: boolean },
  env: Record<string, string | undefined> = process.env,
): boolean {
  return tenant.isDemo === true && env.MESSAGE_DEMO_MODE === "on";
}

const demoSender: MessageSender = {
  channel: "demo",
  showsOnScreen: true,
  async send(tx, msg) {
    // Demo only: the full text (with the code) goes to the WhatsApp simulator. Real senders
    // store the redacted text; codes expire after 10 minutes either way.
    const convo = await ensureConversation(tx, { phone: msg.to });
    await recordMessage(tx, {
      conversationId: convo.id,
      patientId: convo.patientId,
      direction: "out",
      kind: "verification_code",
      body: fill(msg.body, msg.secrets ?? {}),
      channel: "demo",
      status: "delivered",
    });
    console.info(`[demo message] ${msg.template} → ${maskPhone(msg.to)} (not sent, demo mode)`);
  },
};

/** The sender for this clinic, or null when none may be used (→ fail safely). */
export function getMessageSender(
  tenant: { isDemo: boolean },
  env: Record<string, string | undefined> = process.env,
): MessageSender | null {
  if (demoMessagingAllowed(tenant, env)) return demoSender;
  // Phase 2b: return the WhatsApp / SMS sender here when its settings are present.
  return null;
}
