/**
 * Saudi mobile numbers. Patients type them many ways (+966 5…, 00966 5…, 5…, 05…, Arabic digits);
 * we store one form: 05XXXXXXXX (10 digits), the same as the reception screens.
 */
const EASTERN = "٠١٢٣٤٥٦٧٨٩";
const PERSIAN = "۰۱۲۳۴۵۶۷۸۹";

/** Turns Arabic-Indic (and Persian) digits into 0-9. */
export function westernDigits(s: string): string {
  return s.replace(/[٠-٩۰-۹]/g, (d) =>
    String(EASTERN.includes(d) ? EASTERN.indexOf(d) : PERSIAN.indexOf(d)),
  );
}

export function normalizeSaudiMobile(input: string): string | null {
  let digits = westernDigits(input).replace(/[\s\-().]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  if (!/^\d+$/.test(digits)) return null;
  if (digits.startsWith("00966")) digits = digits.slice(5);
  else if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("5") && digits.length === 9) digits = `0${digits}`;
  return /^05\d{8}$/.test(digits) ? digits : null;
}

/** For screens and logs: 05•••••123 (never the whole number). */
export function maskPhone(phone: string): string {
  return phone.length < 6
    ? "•••"
    : `${phone.slice(0, 2)}${"•".repeat(phone.length - 5)}${phone.slice(-3)}`;
}
