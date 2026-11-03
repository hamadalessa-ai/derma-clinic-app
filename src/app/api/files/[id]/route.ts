import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";

const UUID = /^[0-9a-f-]{36}$/i;

/**
 * A photo a patient sent (WhatsApp). Medical: only doctors and admins of this clinic
 * ("photos:view"); RLS keeps other clinics out. Never cached; every view is audited.
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.roles, "photos:view") || !UUID.test(id)) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const actor = actorOf(ctx);
  const file = await withActor(actor, async (tx) => {
    const [row] = await tx.select({ kind: files.kind }).from(files).where(eq(files.id, id));
    if (row?.kind !== "patient_photo") return null;
    const f = await getFileStore().get({ tx }, id);
    if (f) {
      await audit(tx, {
        actorUserId: actor.userId,
        action: "patient_photo.view",
        entityType: "file",
        entityId: id,
      });
    }
    return f;
  });
  if (!file) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(file.data), {
    headers: {
      "Content-Type": file.mimeType,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
