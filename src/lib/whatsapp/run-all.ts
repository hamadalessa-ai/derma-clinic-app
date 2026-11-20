import { getDb } from "@/db/client";
import { tenants } from "@/db/schema";
import { errorName, opsAlert } from "@/lib/ops/alert";
import { whatsappMode } from "./config";
import { runScheduledMessages, type RunSummary } from "./scheduler";
import { sweepStuckMessages } from "./stuck";

/**
 * Runs the scheduled messages for every clinic that has WhatsApp (demo or live). One clinic's
 * failure never stops the others; failures and stuck messages raise an ops alert. Stays within
 * a time budget: `more: true` = call again (nothing is ever sent twice).
 */
export async function runScheduledMessagesForAllClinics(budgetMs = 45_000) {
  const started = Date.now();
  const clinics = await getDb().select().from(tenants);
  const out: Record<string, (RunSummary & { stuck: number }) | "off" | "error" | "later"> = {};
  let more = false;
  for (const t of clinics) {
    // Out of time: the remaining clinics go first on the next call.
    const left = budgetMs - (Date.now() - started);
    if (left < 5_000) {
      out[t.slug] = "later";
      more = true;
      continue;
    }
    if (whatsappMode(t) === "off") {
      out[t.slug] = "off";
      continue;
    }
    try {
      const stuck = await sweepStuckMessages(t.id);
      if (stuck) await opsAlert("whatsapp_messages_stuck", { clinic: t.slug, count: stuck });
      const r = await runScheduledMessages(t, { budgetMs: left - 3_000 });
      more ||= r.more;
      out[t.slug] = { ...r, stuck };
    } catch (err) {
      out[t.slug] = "error";
      await opsAlert("scheduled_messages_failed", { clinic: t.slug, error: errorName(err) });
    }
  }
  return { clinics: out, more };
}
