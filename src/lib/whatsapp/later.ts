import "server-only";
import { after } from "next/server";

/** Sends WhatsApp messages after the response (a slow WhatsApp never slows down the screen). */
export function whatsappLater(fn: () => Promise<unknown>) {
  after(() => fn().catch((err) => console.warn("whatsapp send failed", err)));
}
