/**
 * Messages to patients that carry a secret (verification codes) go through a MessageSender.
 * Since Phase 2b codes travel by WhatsApp like every other message (src/lib/whatsapp/send.ts):
 *   demo  → the WhatsApp simulator, and the code may be shown on screen;
 *   live  → real WhatsApp (code stored masked);
 *   off   → null: verification fails safely with "messaging_unavailable".
 *
 * DEMO SAFETY: demo mode needs BOTH a demo clinic (tenants.is_demo) AND MESSAGE_DEMO_MODE=on.
 * A real clinic never gets the simulator or on-screen codes, even with the flag on.
 */
import type { TenantTx } from "@/db/tenant";
import { maskPhone } from "@/lib/phone";
import { demoMessagingAllowed, whatsappMode, type WaTenant } from "@/lib/whatsapp/config";
import { sendInTransaction } from "@/lib/whatsapp/send";

export { demoMessagingAllowed };

type Env = Record<string, string | undefined>;

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
  readonly channel: "demo" | "whatsapp";
  /** True only in demo mode: the screen may show the message (e.g. the code) itself. */
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

type CodeTenant = WaTenant & { id: string; isDemo: boolean; slug?: string };

/** The sender for this clinic, or null when none may be used (→ fail safely). */
export function getMessageSender(tenant: CodeTenant, env: Env = process.env): MessageSender | null {
  // Sign-in codes still go out while a clinic is read-only (patients may still look at their page);
  // the public actions that ask for codes are already closed for suspended / closed clinics.
  const mode = whatsappMode(tenant, env);
  if (mode === "off" || (!tenant.slug && mode !== "demo")) return null;
  return {
    channel: mode === "demo" ? "demo" : "whatsapp",
    showsOnScreen: mode === "demo",
    async send(tx, msg) {
      const result = await sendInTransaction(
        tx,
        { ...tenant, slug: tenant.slug ?? "" },
        { kind: "verification_code", phone: msg.to, secrets: msg.secrets },
        env,
      );
      if (result.outcome === "failed") {
        console.warn(`[whatsapp] code to ${maskPhone(msg.to)} failed: ${result.error}`);
        throw new MessagingUnavailableError();
      }
      if (mode === "demo") {
        console.info(`[demo message] ${msg.template} → ${maskPhone(msg.to)} (simulator only)`);
      }
    },
  };
}
