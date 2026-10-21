import type { CSSProperties } from "react";
import type { Locale } from "@/i18n/config";

const HEX = /^#[0-9a-f]{6}$/i;

/** CSS variables that apply a clinic's brand colour to everything inside. */
export function brandStyle(color: string | null | undefined): CSSProperties {
  // Invalid or missing: keep the theme's default --brand from globals.css.
  return color && HEX.test(color) ? ({ "--brand": color } as CSSProperties) : {};
}

/** Picks the Arabic or English version of a name. */
export function pick(locale: Locale, ar: string, en: string | null | undefined) {
  return locale === "en" && en ? en : ar;
}
