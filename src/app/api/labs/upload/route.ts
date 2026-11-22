import { NextResponse, type NextRequest } from "next/server";
import { audit } from "@/lib/audit";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";

const TYPES = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX = 4 * 1024 * 1024;

/**
 * A lab's report (PDF, or a photo of the paper) before the results are saved: doctors and
 * nurses only. Returns the stored file's id, which the "Add results" form then sends along.
 * (A route, not a server action: server actions take at most 1 MB.)
 */
export async function POST(req: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.roles, "labs:manage")) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File) || !TYPES.has(file.type) || file.size === 0 || file.size > MAX) {
    return NextResponse.json({ error: "bad_file" }, { status: 400 });
  }
  const actor = actorOf(ctx);
  const data = Buffer.from(await file.arrayBuffer());
  const stored = await withActor(actor, async (tx) => {
    const f = await getFileStore().put(
      { tx, tenantId: actor.tenantId, userId: actor.userId },
      { kind: "lab_report", mimeType: file.type, data },
    );
    await audit(tx, {
      actorUserId: actor.userId,
      action: "lab_report.upload",
      entityType: "file",
      entityId: f.id,
      metadata: { mimeType: f.mimeType, sizeBytes: f.sizeBytes },
    });
    return f;
  });
  return NextResponse.json({ id: stored.id });
}
