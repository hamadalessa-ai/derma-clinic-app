import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { getDb } from "@/db/client";

/**
 * Health check for uptime monitors (e.g. UptimeRobot every 5 minutes, see docs/GO_LIVE.md):
 * 200 when the app and its database answer, 503 when not. Shows nothing about any clinic.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  const started = Date.now();
  try {
    await getDb().execute(sql`select 1`);
    return NextResponse.json(
      { ok: true, db: "up", ms: Date.now() - started },
      { headers: { "cache-control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { ok: false, db: "down" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
