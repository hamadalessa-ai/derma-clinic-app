import { describe, expect, it } from "vitest";
import { formatDualDate, formatGregorian, formatHijri, formatSAR, sarToHalalas } from "./format";

// 17 Oct 2026, 09:00 UTC = 12:00 in Riyadh = 6 Jumada al-Ula 1448 AH (Umm al-Qura)
const date = new Date("2026-10-17T09:00:00Z");

describe("dates", () => {
  it("formats Gregorian dates in Arabic and English", () => {
    expect(formatGregorian(date, "ar")).toBe("17 أكتوبر 2026");
    expect(formatGregorian(date, "en")).toContain("October");
    expect(formatGregorian(date, "en")).toContain("2026");
  });

  it("formats Hijri (Umm al-Qura) dates", () => {
    expect(formatHijri(date, "ar")).toContain("جمادى الأولى");
    expect(formatHijri(date, "ar")).toContain("1448");
    expect(formatHijri(date, "en")).toContain("1448");
  });

  it("uses Riyadh time, not the server's time zone", () => {
    // 22:30 UTC on 17 Oct is already 18 Oct in Riyadh (UTC+3)
    expect(formatGregorian(new Date("2026-10-17T22:30:00Z"), "ar")).toBe("18 أكتوبر 2026");
  });

  it("shows both calendars together", () => {
    const dual = formatDualDate(date, "ar");
    expect(dual).toContain("أكتوبر");
    expect(dual).toContain("1448");
  });
});

describe("SAR currency", () => {
  it("formats whole riyals without decimals", () => {
    expect(formatSAR(125000, "ar")).toBe("1,250\u00a0ر.س.");
    expect(formatSAR(125000, "en")).toBe("SAR\u00a01,250");
  });

  it("keeps halalas when present", () => {
    expect(formatSAR(125050, "en")).toBe("SAR\u00a01,250.50");
  });

  it("rejects fractional halalas", () => {
    expect(() => formatSAR(10.5, "ar")).toThrow();
  });

  it("converts riyals to halalas", () => {
    expect(sarToHalalas(1250.5)).toBe(125050);
  });
});
