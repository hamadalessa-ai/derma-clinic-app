import { NextResponse, type NextRequest } from "next/server";
import { dailyCleanup } from "@/lib/maintenance/cleanup";
import { cronAuthorized } from "@/lib/maintenance/cron-auth";
import { runScheduledMessagesForAllClinics } from "@/lib/whatsapp/run-all";

/**
 * Called once a day by Vercel Cron (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set, the route refuses everything (fails closed). It also runs the scheduled
 * WhatsApp messages, as a safety net if the hourly GitHub schedule stops.
 */
export async function GET(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const removed = await dailyCleanup();
  const messages = await runScheduledMessagesForAllClinics();
  return NextResponse.json({ ok: true, removed, messages });
}
