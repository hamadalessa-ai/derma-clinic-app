/**
 * Clinical photos (before / after): a doctor or nurse takes them in a visit, picks the area and
 * the angle, and later compares two photos of the same area side by side.
 *
 * Clinical: `photos:view` (doctors, nurses, clinic admin) to see, `photos:manage` (doctors and
 * nurses) to add or void — and the database policies say the same. Never shown to reception or
 * patients. Photos are never edited or deleted: a wrong one is voided with a reason. The image
 * itself lives in the file store (kind `clinical_photo`); every view is audited by /api/files.
 */
import { and, asc, eq, isNull } from "drizzle-orm";
import { clinicalPhotos, files, users } from "@/db/schema";
import { PHOTO_AREAS, PHOTO_VIEWS } from "./areas";
import type { TenantTx } from "@/db/tenant";
import { audit } from "@/lib/audit";
import type { Actor } from "@/lib/auth/db";
import { assertCan } from "@/lib/auth/permissions";
import { riyadhDay } from "@/lib/booking/time";

export type PhotoArea = (typeof PHOTO_AREAS)[number];
export type PhotoView = (typeof PHOTO_VIEWS)[number];

export class PhotoError extends Error {
  constructor(public code: "not_found" | "empty" | "bad_file" | "bad_area") {
    super(code);
    this.name = "PhotoError";
  }
}

export const isPhotoArea = (a: string): a is PhotoArea => (PHOTO_AREAS as readonly string[]).includes(a);
export const isPhotoView = (v: string): v is PhotoView => (PHOTO_VIEWS as readonly string[]).includes(v);

/** Records a photo already saved in the file store (kind `clinical_photo`). */
export async function addPhoto(
  tx: TenantTx,
  actor: Actor,
  input: {
    patientId: string;
    fileId: string;
    area: string;
    view: string;
    appointmentId?: string | null;
    note?: string | null;
  },
  today = riyadhDay(new Date()),
) {
  assertCan(actor.roles, "photos:manage");
  if (!isPhotoArea(input.area) || !isPhotoView(input.view)) throw new PhotoError("bad_area");
  const [file] = await tx
    .select({ kind: files.kind })
    .from(files)
    .where(eq(files.id, input.fileId));
  if (file?.kind !== "clinical_photo") throw new PhotoError("bad_file");
  const [row] = await tx
    .insert(clinicalPhotos)
    .values({
      tenantId: actor.tenantId,
      patientId: input.patientId,
      appointmentId: input.appointmentId ?? null,
      fileId: input.fileId,
      area: input.area,
      view: input.view,
      takenOn: today,
      note: input.note?.trim().slice(0, 300) || null,
      takenByUserId: actor.userId,
    })
    .returning();
  await audit(tx, {
    actorUserId: actor.userId,
    action: "photo.add",
    entityType: "patient",
    entityId: input.patientId,
    metadata: { photoId: row.id, area: row.area, view: row.view },
  });
  return row;
}

export async function voidPhoto(
  tx: TenantTx,
  actor: Actor,
  input: { photoId: string; reason: string },
) {
  assertCan(actor.roles, "photos:manage");
  const reason = input.reason.trim().slice(0, 300);
  if (!reason) throw new PhotoError("empty");
  const [row] = await tx
    .update(clinicalPhotos)
    .set({ voidedAt: new Date(), voidedByUserId: actor.userId, voidReason: reason })
    .where(and(eq(clinicalPhotos.id, input.photoId), isNull(clinicalPhotos.voidedAt)))
    .returning();
  if (!row) throw new PhotoError("not_found");
  await audit(tx, {
    actorUserId: actor.userId,
    action: "photo.void",
    entityType: "patient",
    entityId: row.patientId,
    metadata: { photoId: row.id },
  });
  return row;
}

export interface PhotoItem {
  id: string;
  fileId: string;
  area: PhotoArea;
  view: PhotoView;
  takenOn: string;
  note: string | null;
  appointmentId: string | null;
  takenBy: string | null;
  takenByEn: string | null;
}

/** A patient's photos (not voided), grouped by area, oldest first within each area. */
export async function photosForPatient(tx: TenantTx, actor: Actor, patientId: string) {
  assertCan(actor.roles, "photos:view");
  const rows = await tx
    .select({
      id: clinicalPhotos.id,
      fileId: clinicalPhotos.fileId,
      area: clinicalPhotos.area,
      view: clinicalPhotos.view,
      takenOn: clinicalPhotos.takenOn,
      note: clinicalPhotos.note,
      appointmentId: clinicalPhotos.appointmentId,
      takenBy: users.name,
      takenByEn: users.nameEn,
    })
    .from(clinicalPhotos)
    .leftJoin(users, eq(users.id, clinicalPhotos.takenByUserId))
    .where(and(eq(clinicalPhotos.patientId, patientId), isNull(clinicalPhotos.voidedAt)))
    .orderBy(asc(clinicalPhotos.takenOn), asc(clinicalPhotos.createdAt));
  const byArea = new Map<PhotoArea, PhotoItem[]>();
  for (const r of rows) {
    const item = { ...r, area: r.area as PhotoArea, view: r.view as PhotoView };
    const list = byArea.get(item.area) ?? [];
    list.push(item);
    byArea.set(item.area, list);
  }
  return {
    total: rows.length,
    areas: PHOTO_AREAS.filter((a) => byArea.has(a)).map((area) => ({
      area,
      photos: byArea.get(area)!,
    })),
  };
}
