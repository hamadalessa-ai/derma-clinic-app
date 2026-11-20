import { NextResponse, type NextRequest } from "next/server";
import { dailyCleanup } from "@/lib/maintenance/cleanup";
import { cronAuthorized } from "@/lib/maintenance/cron-auth";
import { purgeGlobalLimits } from "@/lib/security/global-limit";
import { runBilling } from "@/lib/platform/billing";
import { runScheduledMessagesForAllClinics } from "@/lib/whatsapp/run-all";

/**
 * Called once a day by Vercel Cron (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set, the route refuses everything (fails closed). It also runs the scheduled
 * WhatsApp messages, as a safety net if the hourly GitHub schedule stops, and the platform billing
 * (this month's statements for live clinics; unpaid past due + grace → read-only).
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const removed = { ...(await dailyCleanup()), globalRateHits: await purgeGlobalLimits() };
  // Billing first: a clinic that just became read-only for an unpaid statement sends no reminders.
  const billing = await runBilling();
  const messages = await runScheduledMessagesForAllClinics(30_000);
  return NextResponse.json({ ok: true, removed, billing, messages });
}
