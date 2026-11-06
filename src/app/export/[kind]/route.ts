import { NextResponse } from "next/server";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { audit } from "@/lib/audit";
import { EXPORT_KINDS, exportCsv, type ExportKind } from "@/lib/export/clinic-export";

export const runtime = "nodejs";

/** Settings → Download clinic data: one CSV per kind, for the clinic admin. Audited. */
export async function GET(_req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!(EXPORT_KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const ctx = await getStaffContext();
  // Support access never includes downloading the clinic's data.
  if (!ctx || !can(ctx.roles, "data:export") || ctx.support) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const actor = actorOf(ctx);
  const csv = await withActor(actor, async (tx) => {
    const text = await exportCsv(tx, kind as ExportKind);
    await audit(tx, {
      actorUserId: actor.userId,
      action: "data.export",
      entityType: "tenant",
      entityId: actor.tenantId,
      metadata: { kind },
    });
    return text;
  });
  const day = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${ctx.tenant.slug}-${kind}-${day}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
