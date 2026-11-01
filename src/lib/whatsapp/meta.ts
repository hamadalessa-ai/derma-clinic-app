/**
 * WhatsApp Cloud API (Meta, directly). Plain fetch, no SDK.
 *  - outside the 24-hour window: an approved template, variables in order, quick-reply payloads;
 *  - inside it: free text, or interactive reply buttons (max 3, titles max 20 characters).
 * Docs: developers.facebook.com/docs/whatsapp/cloud-api
 */
import type { LiveConfig } from "./config";
import type { OutgoingWhatsApp, SendResult, WhatsAppTransport } from "./transport";

/** 05XXXXXXXX → 9665XXXXXXXX (international, no plus). */
export function toInternational(phone: string) {
  return phone.startsWith("0") ? `966${phone.slice(1)}` : phone.replace(/^\+/, "");
}

/** 9665XXXXXXXX → 05XXXXXXXX (how numbers are stored in the clinic). */
export function fromInternational(waId: string) {
  return waId.startsWith("966") ? `0${waId.slice(3)}` : waId;
}

/** The JSON body Meta expects for this message. */
export function metaPayload(msg: OutgoingWhatsApp): Record<string, unknown> {
  const to = toInternational(msg.to);
  if (!msg.insideWindow && msg.template) {
    const components: Record<string, unknown>[] = [];
    if (msg.template.params.length) {
      components.push({
        type: "body",
        parameters: msg.template.params.map((text) => ({ type: "text", text: text || "-" })),
      });
    }
    msg.buttons.slice(0, 3).forEach((b, index) =>
      components.push({
        type: "button",
        sub_type: "quick_reply",
        index: String(index),
        parameters: [{ type: "payload", payload: b.id }],
      }),
    );
    return {
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: { name: msg.template.name, language: { code: msg.language }, components },
    };
  }
  if (msg.buttons.length) {
    return {
      messaging_product: "whatsapp",
      to,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: msg.body.slice(0, 1024) },
        action: {
          buttons: msg.buttons.slice(0, 3).map((b) => ({
            type: "reply",
            reply: { id: b.id, title: b.title.slice(0, 20) },
          })),
        },
      },
    };
  }
  return {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: { body: msg.body.slice(0, 4096), preview_url: true },
  };
}

export function createMetaTransport(
  config: LiveConfig,
  fetchImpl: typeof fetch = fetch,
): WhatsAppTransport {
  return {
    channel: "meta",
    async send(msg): Promise<SendResult> {
      if (!msg.insideWindow && !msg.template) {
        return { ok: false, errorCode: "outside_window", errorText: "Outside the 24-hour window" };
      }
      try {
        const res = await fetchImpl(
          `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${config.accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(metaPayload(msg)),
            signal: AbortSignal.timeout(10_000),
          },
        );
        const json = (await res.json().catch(() => ({}))) as {
          messages?: { id: string }[];
          error?: { code?: number; message?: string; error_data?: { details?: string } };
        };
        if (res.ok && json.messages?.[0]?.id) {
          return { ok: true, providerMessageId: json.messages[0].id };
        }
        return {
          ok: false,
          errorCode: String(json.error?.code ?? res.status),
          errorText: [json.error?.message, json.error?.error_data?.details]
            .filter(Boolean)
            .join(" — ")
            .slice(0, 500),
        };
      } catch (err) {
        return { ok: false, errorCode: "network", errorText: String(err).slice(0, 300) };
      }
    },
  };
}
