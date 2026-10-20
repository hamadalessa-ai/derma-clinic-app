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

const MAX_BYTES = 2 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

/** Shrinks images before storing (signatures become small palette PNGs). */
export async function compressImage(data: Buffer, mimeType: string) {
  if (!IMAGE_TYPES.has(mimeType)) return { data, mimeType };
  const out = await sharp(data)
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .png({ palette: true, compressionLevel: 9 })
    .toBuffer();
  return { data: out, mimeType: "image/png" };
}

export const postgresFileStore: FileStore = {
  async put({ tx, tenantId, userId }, file) {
    if (file.data.length === 0 || file.data.length > MAX_BYTES)
      throw new Error("file too large or empty");
    const { data, mimeType } = await compressImage(file.data, file.mimeType);
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
