import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { whatsappMode } from "./config";
import { runScheduledMessages, type RunSummary } from "./scheduler";

/** Runs the scheduled messages for every clinic that has WhatsApp (demo or live). */
export async function runScheduledMessagesForAllClinics() {
  const clinics = await getDb().select().from(tenants);
  const out: Record<string, RunSummary | "off"> = {};
  for (const t of clinics) {
    out[t.slug] = whatsappMode(t) === "off" ? "off" : await runScheduledMessages(t);
  }
  return out;
}
