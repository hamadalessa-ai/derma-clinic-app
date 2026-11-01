import { NextResponse, type NextRequest } from "next/server";
import { cronAuthorized } from "@/lib/maintenance/cron-auth";
import { runScheduledMessagesForAllClinics } from "@/lib/whatsapp/run-all";

/**
 * Scheduled WhatsApp messages. Called every hour by GitHub Actions
 * (.github/workflows/scheduled-messages.yml) with "Authorization: Bearer <CRON_SECRET>".
 * Safe to call any number of times: nothing is ever sent twice.
 */
async function run(request: NextRequest) {
  if (!cronAuthorized(request.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  return NextResponse.json({ ok: true, clinics: await runScheduledMessagesForAllClinics() });
}

export const GET = run;
export const POST = run;
