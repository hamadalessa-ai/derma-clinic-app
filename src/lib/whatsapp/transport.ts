/**
 * How a message physically leaves: the "transport". One per provider.
 *  - demo: nothing leaves; the WhatsApp simulator shows the stored message.
 *  - meta: WhatsApp Cloud API (./meta.ts).
 * Adding a provider (e.g. Unifonic, Taqnyat, Twilio, 360dialog) = one new file implementing
 * WhatsAppTransport + one line in TRANSPORTS below. Nothing else changes.
 */
import type { LiveConfig, ProviderName } from "./config";
import { createMetaTransport } from "./meta";

export interface OutgoingWhatsApp {
  /** 05XXXXXXXX */
  to: string;
  language: "ar" | "en";
  /** The finished text (what the patient reads). */
  body: string;
  /** Reply buttons; `id` is the signed payload that comes back when tapped. */
  buttons: { id: string; title: string }[];
  /**
   * Approved Meta template to use when outside the 24-hour window (business-initiated).
   * Inside the window the free text + buttons above are sent instead.
   */
  template: { name: string; params: string[] } | null;
  /** The patient wrote to us in the last 24 hours (free messages allowed). */
  insideWindow: boolean;
}

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  | { ok: false; errorCode: string; errorText: string };

export interface WhatsAppTransport {
  readonly channel: "demo" | ProviderName;
  send(msg: OutgoingWhatsApp): Promise<SendResult>;
}

export const demoTransport: WhatsAppTransport = {
  channel: "demo",
  async send() {
    return { ok: true, providerMessageId: null };
  },
};

const TRANSPORTS: Record<ProviderName, (config: LiveConfig) => WhatsAppTransport> = {
  meta: createMetaTransport,
};

export function liveTransport(config: LiveConfig): WhatsAppTransport {
  return TRANSPORTS[config.provider](config);
}
