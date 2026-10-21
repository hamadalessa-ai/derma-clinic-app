import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { dailyCleanup } from "@/lib/maintenance/cleanup";

/**
 * Called once a day by Vercel Cron (vercel.json). Vercel sends "Authorization: Bearer <CRON_SECRET>".
 * Without CRON_SECRET set, the route refuses everything (fails closed).
 */
export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  const given = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${secret}`;
  const ok =
    !!secret &&
    secret.length >= 16 &&
    given.length === expected.length &&
    timingSafeEqual(Buffer.from(given), Buffer.from(expected));
  if (!ok) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const removed = await dailyCleanup();
  return NextResponse.json({ ok: true, removed });
}
