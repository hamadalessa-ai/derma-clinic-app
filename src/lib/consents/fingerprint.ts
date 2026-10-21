import { createHash } from "node:crypto";

/** sha256 of a consent's exact text, stored with each signature so later changes are detectable. */
export function contentFingerprint(t: {
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
}) {
  return createHash("sha256")
    .update(JSON.stringify([t.titleAr, t.titleEn, t.bodyAr, t.bodyEn]))
    .digest("hex");
}
