import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import sharp from "sharp";
import { TRICKY_LINES } from "./bidi-cases";
import { renderConsentPdf, type ConsentPdfData } from "./consent-pdf";

function hasPdftotext() {
  try {
    execFileSync("pdftotext", ["-v"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

async function sampleConsent(): Promise<ConsentPdfData> {
  const signaturePng = await sharp({
    create: { width: 360, height: 120, channels: 4, background: "#ffffff" },
  })
    .png()
    .toBuffer();
  return {
    clinicNameAr: "عيادات ديرما",
    clinicNameEn: "Derma Clinics",
    titleAr: "نموذج موافقة على جلسات ليزر إزالة الشعر",
    titleEn: "Consent for Laser Hair Removal sessions",
    bodyAr: TRICKY_LINES.filter((l) => l.base === "rtl")
      .map((l) => l.text)
      .join("\n"),
    bodyEn: "I consent to the procedure. Price 1,250 SAR, date 2026/10/21, Dr. Sarah (د. سارة).",
    patientNameAr: "نورة عبدالرحمن القحطاني",
    patientNameEn: "Noura Abdulrahman Al-Qahtani",
    fileNumber: "D-0001",
    signerName: "نورة القحطاني",
    signerRelationAr: "المريضة نفسها",
    witnessName: "هند المطيري",
    signedAtAr: "21 أكتوبر 2026 · 9 جمادى الأولى 1448 هـ · 10:30",
    signedAtEn: "21 October 2026 · 9 Jumada I 1448 AH · 10:30",
    templateCode: "laser_hair_removal",
    templateVersion: 1,
    fingerprint: "a".repeat(64),
    intact: true,
    signaturePng,
  };
}

describe("consent PDF", () => {
  it("renders a valid PDF with the tricky mixed lines", async () => {
    const pdf = await renderConsentPdf(await sampleConsent());
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pdf.length).toBeGreaterThan(5_000);
    // For visual checking: PDF_SAMPLE_OUT=/path/sample.pdf pnpm vitest run consent-pdf
    if (process.env.PDF_SAMPLE_OUT) writeFileSync(process.env.PDF_SAMPLE_OUT, pdf);

    if (!hasPdftotext()) return;
    const dir = mkdtempSync(path.join(tmpdir(), "consent-"));
    const file = path.join(dir, "c.pdf");
    writeFileSync(file, pdf);
    const text = execFileSync("pdftotext", ["-enc", "UTF-8", file, "-"])
      .toString()
      .normalize("NFKC");
    // English, numbers and dates come out intact and in order.
    for (const s of [
      "Laser Hair Removal",
      "1,250",
      "2026/10/21",
      "D-0001",
      "admin@derma.demo",
      "Morpheus8",
      "1448/05/09",
    ]) {
      expect(text).toContain(s);
    }
    // Every Arabic word is present as a whole word (letters joined, not split apart).
    // Words containing ل are skipped here only because pdftotext mis-orders this font's
    // lam ligatures when EXTRACTING (they render correctly; see the browser referee test
    // e2e/pdf-bidi.spec.ts and the "never splits an Arabic word" unit test).
    const arabicWords = TRICKY_LINES.flatMap((l) => l.text.match(/[ء-ي]{3,}/g) ?? []).filter(
      (w) => !w.includes("ل"),
    );
    expect(arabicWords.length).toBeGreaterThanOrEqual(12);
    const missing = arabicWords.filter((w) => !text.includes(w));
    expect(missing).toEqual([]);
  });
});
