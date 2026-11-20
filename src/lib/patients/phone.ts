/** Phone helpers that also run in the browser (no database). */
const ARABIC_DIGITS = "٠١٢٣٤٥٦٧٨٩";

/** Turns "٠٥٠٠ ٠١٠ ٠٠٣" or "+966 500010003" into "0500010003". */
export function normalizePhoneQuery(q: string): string {
  let digits = q.replace(/[٠-٩]/g, (d) => String(ARABIC_DIGITS.indexOf(d))).replace(/\D/g, "");
  if (digits.startsWith("966")) digits = `0${digits.slice(3)}`;
  return digits;
}
