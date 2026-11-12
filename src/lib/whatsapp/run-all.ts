import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { errorName, opsAlert } from "@/lib/ops/alert";
import { whatsappMode } from "./config";
import { runScheduledMessages, type RunSummary } from "./scheduler";
import { sweepStuckMessages } from "./stuck";

/**
 * Runs the scheduled messages for every clinic that has WhatsApp (demo or live). One clinic's
 * failure never stops the others; failures and stuck messages raise an ops alert.
 */
export async function runScheduledMessagesForAllClinics() {
  const clinics = await getDb().select().from(tenants);
  const out: Record<string, (RunSummary & { stuck: number }) | "off" | "error"> = {};
  for (const t of clinics) {
    if (whatsappMode(t) === "off") {
      out[t.slug] = "off";
      continue;
    }
    try {
      const stuck = await sweepStuckMessages(t.id);
      if (stuck) await opsAlert("whatsapp_messages_stuck", { clinic: t.slug, count: stuck });
      out[t.slug] = { ...(await runScheduledMessages(t)), stuck };
    } catch (err) {
      out[t.slug] = "error";
      await opsAlert("scheduled_messages_failed", { clinic: t.slug, error: errorName(err) });
    }
  }
  return out;
}
