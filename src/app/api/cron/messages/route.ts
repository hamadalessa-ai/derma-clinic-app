import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/maintenance/cron-auth";
import { runScheduledMessagesForAllClinics } from "@/lib/whatsapp/run-all";

/**
 * Scheduled WhatsApp messages. Called every hour by GitHub Actions
 * (.github/workflows/scheduled-messages.yml) with "Authorization: Bearer <CRON_SECRET>".
 * Safe to call any number of times: nothing is ever sent twice. `more: true` = time ran out, call
 * again (the workflow loops).
 */
export const maxDuration = 60;
async function run(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { clinics, more } = await runScheduledMessagesForAllClinics();
  return NextResponse.json({ ok: true, more, clinics });
}

export const GET = run;
export const POST = run;
