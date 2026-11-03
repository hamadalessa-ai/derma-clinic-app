/**
 * Meta's WhatsApp webhook: signature check and turning Meta's JSON into InboundEvents
 * (the same events the simulator produces). Unknown shapes are skipped, never thrown.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { InboundEvent } from "./inbound";
import { fromInternational } from "./meta";

/** X-Hub-Signature-256: "sha256=" + HMAC-SHA256(app secret, raw body). */
export function validSignature(rawBody: string, header: string | null, appSecret: string) {
  if (!header || !header.startsWith("sha256=") || !appSecret) return false;
  const expected = `sha256=${createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex")}`;
  const a = Buffer.from(expected);
  const b = Buffer.from(header);
  return a.length === b.length && timingSafeEqual(a, b);
}

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (v && typeof v === "object" ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const str = (v: unknown): string | undefined => (typeof v === "string" ? v : undefined);

export function parseMetaWebhook(body: unknown): InboundEvent[] {
  const events: InboundEvent[] = [];
  for (const entry of arr(obj(body).entry)) {
    for (const change of arr(obj(entry).changes)) {
      const value = obj(obj(change).value);
      const names = new Map<string, string>();
      for (const c of arr(value.contacts)) {
        const waId = str(obj(c).wa_id);
        const name = str(obj(obj(c).profile).name);
        if (waId && name) names.set(waId, name);
      }
      for (const raw of arr(value.messages)) {
        const m = obj(raw);
        const id = str(m.id);
        const from = str(m.from);
        if (!id || !from) continue;
        const base = {
          type: "message" as const,
          eventId: id,
          from: fromInternational(from),
          profileName: names.get(from) ?? null,
        };
        const type = str(m.type);
        if (type === "text") {
          events.push({ ...base, kind: "text", text: str(obj(m.text).body) ?? "" });
        } else if (type === "button") {
          // A quick-reply button on a template.
          events.push({
            ...base,
            kind: "button",
            buttonPayload: str(obj(m.button).payload),
            buttonTitle: str(obj(m.button).text),
          });
        } else if (type === "interactive") {
          const reply = obj(obj(m.interactive).button_reply);
          events.push({
            ...base,
            kind: "button",
            buttonPayload: str(reply.id),
            buttonTitle: str(reply.title),
          });
        } else if (type === "image") {
          // A photo (e.g. of the treated area). Downloaded with the access token when handled.
          const image = obj(m.image);
          events.push({
            ...base,
            kind: "image",
            text: str(image.caption) ?? "",
            media: { id: str(image.id), mimeType: str(image.mime_type) ?? "image/jpeg" },
          });
        } else {
          events.push({ ...base, kind: "unsupported", unsupportedType: type ?? "unknown" });
        }
      }
      for (const raw of arr(value.statuses)) {
        const s = obj(raw);
        const id = str(s.id);
        const status = str(s.status);
        if (!id || !["sent", "delivered", "read", "failed"].includes(status ?? "")) continue;
        const err = obj(arr(s.errors)[0]);
        events.push({
          type: "status",
          eventId: `${id}:${status}`,
          providerMessageId: id,
          status: status as "sent" | "delivered" | "read" | "failed",
          errorCode: err.code !== undefined ? String(err.code) : null,
          errorText: str(obj(err.error_data).details) ?? str(err.title) ?? str(err.message) ?? null,
        });
      }
    }
  }
  return events;
}
