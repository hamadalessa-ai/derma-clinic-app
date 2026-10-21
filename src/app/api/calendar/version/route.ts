import { NextResponse, type NextRequest } from "next/server";
import { sql } from "drizzle-orm";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";

/**
 * A tiny fingerprint of the schedule data shown on screen. Calendar and My Day poll this
 * every 15 s and reload only when it changes. RLS applies (clinic, branch).
 */
export async function GET(req: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx || !can(ctx.roles, "calendar:view"))
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const from = new Date(req.nextUrl.searchParams.get("from") ?? "");
  const to = new Date(req.nextUrl.searchParams.get("to") ?? "");
  if (
    Number.isNaN(from.getTime()) ||
    Number.isNaN(to.getTime()) ||
    to <= from ||
    to.getTime() - from.getTime() > 32 * 86400_000
  ) {
    return NextResponse.json({ error: "bad range" }, { status: 400 });
  }
  const [row] = (await withActor(actorOf(ctx), (tx) =>
    tx.execute(sql`
      select md5(
        coalesce((select string_agg(id::text || status || updated_at::text, ',' order by id)
                    from appointments where starts_at >= ${from.toISOString()}::timestamptz and starts_at < ${to.toISOString()}::timestamptz), '')
        || '|' ||
        coalesce((select string_agg(id::text || updated_at::text, ',' order by id)
                    from time_blocks where starts_at < ${to.toISOString()}::timestamptz and ends_at >= ${from.toISOString()}::timestamptz), '')
        || '|' ||
        coalesce((select string_agg(id::text || status, ',' order by id) from reschedule_requests where status = 'pending'), '')
      ) as version`),
  )) as unknown as { version: string }[];
  return NextResponse.json({ version: row.version }, { headers: { "Cache-Control": "no-store" } });
}
