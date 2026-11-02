import { NextResponse } from "next/server";
import { sql } from "drizzle-orm";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";

/** A tiny fingerprint of the WhatsApp chats; the inbox and simulator poll it and reload on change. */
export async function GET() {
  const ctx = await getStaffContext();
  if (!ctx || !(can(ctx.roles, "whatsapp:inbox") || can(ctx.roles, "whatsapp:simulator"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const [row] = (await withActor(actorOf(ctx), (tx) =>
    tx.execute(sql`
      select md5(
        coalesce((select max(last_message_at)::text || count(*)::text || sum(needs_reply::int)::text from conversations), '')
        || '|' ||
        coalesce((select max(status_at)::text || count(*)::text from messages), '')
      ) as version`),
  )) as unknown as { version: string }[];
  return NextResponse.json({ version: row.version }, { headers: { "Cache-Control": "no-store" } });
}
