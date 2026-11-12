/**
 * Encrypts small secrets we must store (e.g. a clinic's WhatsApp access token) with AES-256-GCM.
 * The key is derived from DATA_ENCRYPTION_KEY, or from BETTER_AUTH_SECRET when that isn't set
 * (no extra setting to manage). Changing that secret makes stored values unreadable: they then
 * have to be entered again. Each purpose gets its own key, so one value can't be swapped for
 * another kind.
 */
import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from "node:crypto";

type Env = Record<string, string | undefined>;

function keyFor(purpose: string, env: Env): Buffer {
  const secret = env.DATA_ENCRYPTION_KEY || env.BETTER_AUTH_SECRET;
  if (!secret || secret.length < 16) throw new Error("No encryption secret configured");
  return Buffer.from(hkdfSync("sha256", secret, "clinic-platform/secret-box", purpose, 32));
}

export function sealSecret(plain: string, purpose: string, env: Env = process.env): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyFor(purpose, env), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `v1:${Buffer.concat([iv, cipher.getAuthTag(), data]).toString("base64")}`;
}

/** The secret, or null when it can't be read (wrong key, damaged, or not ours). */
export function openSecret(sealed: string | null | undefined, purpose: string, env: Env = process.env) {
  if (!sealed?.startsWith("v1:")) return null;
  try {
    const raw = Buffer.from(sealed.slice(3), "base64");
    const decipher = createDecipheriv("aes-256-gcm", keyFor(purpose, env), raw.subarray(0, 12));
    decipher.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
