import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { withActor } from "@/lib/auth/db";
import { can } from "@/lib/auth/permissions";
import { actorOf, getStaffContext } from "@/lib/auth/session";
import { getFileStore } from "@/lib/files/store";
import { addPhoto, PhotoError } from "@/lib/photos/photos";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/heic"]);
const MAX = 10 * 1024 * 1024;
const Fields = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().nullish(),
  area: z.string().max(20),
  view: z.string().max(20),
  note: z.string().max(300).nullish(),
});

/**
 * A before / after photo taken in a visit (camera or a saved picture): doctors and nurses only.
 * Saves the image (shrunk) and the photo record in one transaction. (A route, not a server
 * action: server actions take at most 1 MB.)
 */
export async function POST(req: NextRequest) {
  const ctx = await getStaffContext();
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!can(ctx.roles, "photos:manage")) {
    return NextResponse.json({ error: "not allowed" }, { status: 403 });
  }
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  const fields = Fields.safeParse({
    patientId: form?.get("patientId"),
    appointmentId: form?.get("appointmentId") || null,
    area: form?.get("area"),
    view: form?.get("view"),
    note: form?.get("note") || null,
  });
  if (
    !fields.success ||
    !(file instanceof File) ||
    !TYPES.has(file.type) ||
    file.size === 0 ||
    file.size > MAX
  ) {
    return NextResponse.json({ error: "photos_bad_file" }, { status: 400 });
  }
  const actor = actorOf(ctx);
  const data = Buffer.from(await file.arrayBuffer());
  try {
    const photo = await withActor(actor, async (tx) => {
      const f = await getFileStore().put(
        { tx, tenantId: actor.tenantId, userId: actor.userId },
        { kind: "clinical_photo", mimeType: file.type, data },
      );
      await audit(tx, {
        actorUserId: actor.userId,
        action: "clinical_photo.upload",
        entityType: "file",
        entityId: f.id,
        metadata: { mimeType: f.mimeType, sizeBytes: f.sizeBytes },
      });
      return addPhoto(tx, actor, { ...fields.data, fileId: f.id });
    });
    return NextResponse.json({ id: photo.id });
  } catch (e) {
    if (e instanceof PhotoError) {
      return NextResponse.json({ error: `photos_${e.code}` }, { status: 400 });
    }
    throw e;
  }
}
