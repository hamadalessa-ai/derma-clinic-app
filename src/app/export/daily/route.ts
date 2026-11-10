import { NextResponse } from "next/server";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { isDay } from "@/lib/booking/time";
import { dailyInvoicingCsv } from "@/lib/reports/daily-export";
import { reportBranches } from "@/lib/reports/owner";

export const runtime = "nodejs";

/** Reports → daily file for the clinic's invoicing system (CSV). Clinic admin only. Audited. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const day = url.searchParams.get("day");
  if (!isDay(day)) return NextResponse.json({ error: "bad day" }, { status: 400 });
  const ctx = await getStaffContext();
  // Support access never includes downloading the clinic's data.
  if (!ctx || !can(ctx.roles, "invoicing:export") || ctx.support) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const actor = actorOf(ctx);
  const wanted = url.searchParams.get("branch");
  const out = await withActor(actor, async (tx) => {
    const branchId =
      wanted && (await reportBranches(tx)).some((b) => b.id === wanted) ? wanted : null;
    const r = await dailyInvoicingCsv(tx, actor, day, branchId);
    await audit(tx, {
      actorUserId: actor.userId,
      action: "invoicing.export",
      entityType: "tenant",
      entityId: actor.tenantId,
      metadata: { day, branchId, rows: r.rows },
    });
    return r;
  });
  return new NextResponse(out.csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.tenant.slug}-invoicing-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
