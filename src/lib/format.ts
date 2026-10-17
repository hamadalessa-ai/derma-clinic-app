import type { Locale } from "@/i18n/config";

export const CLINIC_TIME_ZONE = "Asia/Riyadh";

// Western digits (0-9) are used in both languages so phone numbers, prices and file
// numbers look the same everywhere. Change to "arab" for Arabic-Indic digits (٠-٩).
const NUMBERING = "latn";

function tag(locale: Locale, calendar: "gregory" | "islamic-umalqura") {
  const base = locale === "ar" ? "ar-SA" : "en-SA";
  return `${base}-u-ca-${calendar}-nu-${NUMBERING}`;
}

type DateStyle = "short" | "medium" | "long" | "full";

/** Gregorian date, e.g. "17 أكتوبر 2026" / "17 October 2026". */
export function formatGregorian(date: Date, locale: Locale, style: DateStyle = "long") {
  return new Intl.DateTimeFormat(tag(locale, "gregory"), {
    dateStyle: style,
    timeZone: CLINIC_TIME_ZONE,
  }).format(date);
}

/** Hijri (Umm al-Qura, the official Saudi calendar), e.g. "6 جمادى الأولى 1448 هـ". */
export function formatHijri(date: Date, locale: Locale, style: DateStyle = "long") {
  return new Intl.DateTimeFormat(tag(locale, "islamic-umalqura"), {
    dateStyle: style,
    timeZone: CLINIC_TIME_ZONE,
  }).format(date);
}

/** Both calendars together, e.g. "17 أكتوبر 2026 · 6 جمادى الأولى 1448 هـ". */
export function formatDualDate(date: Date, locale: Locale, style: DateStyle = "long") {
  return `${formatGregorian(date, locale, style)} · ${formatHijri(date, locale, style)}`;
}

export function formatTime(date: Date, locale: Locale) {
  return new Intl.DateTimeFormat(tag(locale, "gregory"), {
    hour: "numeric",
    minute: "2-digit",
    timeZone: CLINIC_TIME_ZONE,
  }).format(date);
}

/**
 * Money is stored as whole halalas (1 SAR = 100 halalas) to avoid rounding errors.
 * formatSAR(125000, "ar") → "1,250 ر.س.", formatSAR(125050, "en") → "SAR 1,250.50"
 */
export function formatSAR(halalas: number, locale: Locale) {
  if (!Number.isInteger(halalas)) throw new Error("formatSAR expects an integer number of halalas");
  const riyals = halalas / 100;
  return new Intl.NumberFormat(locale === "ar" ? `ar-SA-u-nu-${NUMBERING}` : "en-SA", {
    style: "currency",
    currency: "SAR",
    minimumFractionDigits: halalas % 100 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })
    .format(riyals)
    .replace(/[‎‏؜]/g, ""); // strip invisible direction marks; the page sets direction
}

export function sarToHalalas(riyals: number) {
  return Math.round(riyals * 100);
}
