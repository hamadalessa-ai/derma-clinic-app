/**
 * FileStore: the ONLY way the app saves or reads files (signatures now, photos later).
 * Screens never know where files live. The demo stores them in Postgres; moving to an
 * S3-compatible store in Saudi Arabia means adding another implementation here.
 */
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import type { TenantTx } from "@/db/tenant";
import { files } from "@/db/schema";

export interface StoredFile {
  id: string;
  mimeType: string;
  sizeBytes: number;
  sha256: string;
}

export interface FileStore {
  put(
    ctx: { tx: TenantTx; tenantId: string; userId: string | null },
    file: { kind: string; mimeType: string; data: Buffer },
  ): Promise<StoredFile>;
  get(ctx: { tx: TenantTx }, id: string): Promise<(StoredFile & { data: Buffer }) | null>;
}

/** Before shrinking: signatures are small; photos from a phone camera can be several MB. */
const MAX_BYTES: Record<string, number> = {
  patient_photo: 10 * 1024 * 1024,
  // A lab's report: a PDF, or a phone photo of the paper (shrunk like a patient photo).
  lab_report: 4 * 1024 * 1024,
  // Before / after photos taken in a visit (phone or tablet camera).
  clinical_photo: 10 * 1024 * 1024,
};
const DEFAULT_MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/heic"]);

/**
 * Shrinks images before storing: signatures become small palette PNGs; photos become JPEGs
 * (max 1600 px, good enough to judge redness or swelling, ~200–400 KB).
 */
export async function compressImage(data: Buffer, mimeType: string, kind = "signature") {
  if (!IMAGE_TYPES.has(mimeType)) return { data, mimeType };
  if (kind === "patient_photo" || kind === "lab_report" || kind === "clinical_photo") {
    const out = await sharp(data)
      .rotate()
      .resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    return { data: out, mimeType: "image/jpeg" };
  }
  const out = await sharp(data)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
  return { data: out, mimeType: "image/png" };
}

export const postgresFileStore: FileStore = {
  async put({ tx, tenantId, userId }, file) {
    if (file.data.length === 0 || file.data.length > (MAX_BYTES[file.kind] ?? DEFAULT_MAX_BYTES))
      throw new Error("file too large or empty");
    const { data, mimeType } = await compressImage(file.data, file.mimeType, file.kind);
    const sha256 = createHash("sha256").update(data).digest("hex");
    const [row] = await tx
      .insert(files)
      .values({
        tenantId,
        kind: file.kind,
        mimeType,
        sizeBytes: data.length,
        sha256,
        data,
        createdBy: userId,
      })
      .returning({
        id: files.id,
        mimeType: files.mimeType,
        sizeBytes: files.sizeBytes,
        sha256: files.sha256,
      });
    return row;
  },
  async get({ tx }, id) {
    const [row] = await tx.select().from(files).where(eq(files.id, id)).limit(1);
    if (!row) return null;
    return {
      id: row.id,
      mimeType: row.mimeType,
      sizeBytes: row.sizeBytes,
      sha256: row.sha256,
      data: Buffer.from(row.data),
    };
  },
};

/** The store in use. Later: choose by env (e.g. FILE_STORE=s3). */
export function getFileStore(): FileStore {
  return postgresFileStore;
}
