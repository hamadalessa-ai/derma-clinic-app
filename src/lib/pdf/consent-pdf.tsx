/**
 * Signed consent as a PDF. A VIEW of the official database record (patient_consents);
 * the browser print page (/consents/[id]/print) is the other view.
 *
 * Arabic text goes through bidi-layout.ts (Unicode bidi algorithm + real font widths),
 * so mixed Arabic / English / numbers / dates render in the same order as in a browser.
 */
import path from "node:path";
import {
  Document,
  Font,
  Image,
  Page,
  renderToBuffer,
  StyleSheet,
  Text,
  View,
} from "@react-pdf/renderer";
import * as fontkit from "fontkit";
import type { Font as FontkitFont } from "fontkit";
import { THEME } from "@/app/theme";
import { fontMeasurer, layoutParagraph, type Line } from "./bidi-layout";

const FONT_DIR = path.join(process.cwd(), "src/lib/pdf/fonts");
const REGULAR = path.join(FONT_DIR, "IBMPlexSansArabic-400.ttf");
const BOLD = path.join(FONT_DIR, "IBMPlexSansArabic-700.ttf");

let registered = false;
function ensureFonts() {
  if (registered) return;
  Font.register({ family: "Plex", fonts: [{ src: REGULAR }, { src: BOLD, fontWeight: 700 }] });
  Font.registerHyphenationCallback((word) => [word]); // never hyphenate (we break lines ourselves)
  registered = true;
}

let fonts: { regular: FontkitFont; bold: FontkitFont } | null = null;
function measureFonts() {
  fonts ??= {
    regular: fontkit.openSync(REGULAR) as FontkitFont,
    bold: fontkit.openSync(BOLD) as FontkitFont,
  };
  return fonts;
}

// Print colour comes from the central theme.
const INK = THEME.ink;
const PAGE = { width: 595, padding: 40 }; // A4 in points
const CONTENT_WIDTH = PAGE.width - PAGE.padding * 2;

const styles = StyleSheet.create({
  page: { fontFamily: "Plex", fontSize: 10.5, padding: PAGE.padding, color: INK },
  line: { flexDirection: "row", flexWrap: "nowrap" },
  section: { marginBottom: 10 },
  rule: { borderBottomWidth: 0.5, borderBottomColor: INK, marginVertical: 8 },
  signature: { width: 180, height: 68, objectFit: "contain" },
  small: { fontSize: 8 },
});

/** Leaves out characters the font can't draw (e.g. emoji), instead of printing empty boxes. */
export function drawable(text: string, font: FontkitFont) {
  return [...text]
    .filter((ch) => /\s/.test(ch) || font.hasGlyphForCodePoint(ch.codePointAt(0)!))
    .join("");
}

/** Draws one paragraph line by line, each line already in visual order. */
function Paragraph({
  text,
  dir,
  size = 10.5,
  bold = false,
  gap = 2,
}: {
  text: string;
  dir: "rtl" | "ltr";
  size?: number;
  bold?: boolean;
  gap?: number;
}) {
  const f = measureFonts();
  const font = bold ? f.bold : f.regular;
  const m = fontMeasurer(font, size);
  const spaceWidth = m.width(" ");
  const lines: Line[] = drawable(text, font)
    .split(/\n+/)
    .flatMap((p) => (p.trim() ? layoutParagraph(p.trim(), CONTENT_WIDTH, m, dir) : []));
  return (
    <View style={{ marginBottom: gap * 3 }}>
      {lines.map((line, i) => (
        <View
          key={i}
          style={[
            styles.line,
            { justifyContent: dir === "rtl" ? "flex-end" : "flex-start", marginBottom: gap },
          ]}
        >
          {line.atoms.map((a, j) =>
            a.space ? (
              <View key={j} style={{ width: spaceWidth * a.text.length }} />
            ) : (
              <Text key={j} style={{ fontSize: size, fontWeight: bold ? 700 : 400 }}>
                {a.text}
              </Text>
            ),
          )}
        </View>
      ))}
    </View>
  );
}

export interface ConsentPdfData {
  clinicNameAr: string;
  clinicNameEn: string;
  titleAr: string;
  titleEn: string;
  bodyAr: string;
  bodyEn: string;
  patientNameAr: string;
  patientNameEn: string | null;
  fileNumber: string;
  signerName: string;
  signerRelationAr: string;
  witnessName: string;
  signedAtAr: string; // pre-formatted (Gregorian · Hijri · time), Riyadh time
  signedAtEn: string;
  templateCode: string;
  templateVersion: number;
  fingerprint: string;
  intact: boolean;
  signaturePng: Buffer;
}

export function ConsentDocument({ d }: { d: ConsentPdfData }) {
  return (
    <Document
      title={`${d.titleEn} — ${d.fileNumber}`}
      author={d.clinicNameEn}
      creator="Clinic Platform (demo)"
    >
      <Page size="A4" style={styles.page}>
        <Paragraph text={`${d.clinicNameAr} | ${d.clinicNameEn}`} dir="rtl" size={14} bold />
        <View style={styles.rule} />
        <Paragraph text={d.titleAr} dir="rtl" size={13} bold />
        <Paragraph text={d.titleEn} dir="ltr" size={11} bold />
        <View style={styles.section}>
          <Paragraph text={`المريض: ${d.patientNameAr} – رقم الملف ${d.fileNumber}`} dir="rtl" />
          {d.patientNameEn && (
            <Paragraph text={`Patient: ${d.patientNameEn} – File ${d.fileNumber}`} dir="ltr" />
          )}
        </View>
        <View style={styles.rule} />
        <Paragraph text={d.bodyAr} dir="rtl" />
        <View style={styles.rule} />
        <Paragraph text={d.bodyEn} dir="ltr" />
        <View style={styles.rule} />
        <View
          style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "flex-end" }}
        >
          <View>
            {/* eslint-disable-next-line jsx-a11y/alt-text -- react-pdf images have no alt text */}
            <Image src={{ data: d.signaturePng, format: "png" }} style={styles.signature} />
            <Paragraph text={`Signer: ${d.signerName}`} dir="ltr" size={9} />
          </View>
          <View style={{ width: CONTENT_WIDTH - 200 }}>
            <Paragraph text={`الموقّع: ${d.signerName} (${d.signerRelationAr})`} dir="rtl" />
            <Paragraph text={`الشاهد من العيادة: ${d.witnessName}`} dir="rtl" />
            <Paragraph text={`تاريخ التوقيع: ${d.signedAtAr}`} dir="rtl" />
            <Paragraph text={`Signed: ${d.signedAtEn}`} dir="ltr" size={9} />
          </View>
        </View>
        <View style={styles.rule} />
        <Paragraph
          text={`Template ${d.templateCode} v${d.templateVersion} · SHA-256 ${d.fingerprint.slice(0, 16)}… · ${d.intact ? "record intact" : "WARNING: record altered"}`}
          dir="ltr"
          size={7.5}
        />
        <Paragraph
          text="هذه نسخة PDF من سجل الموافقة الرسمي المحفوظ في النظام. نسخة تجريبية — بيانات وهمية."
          dir="rtl"
          size={8}
        />
      </Page>
    </Document>
  );
}

export async function renderConsentPdf(d: ConsentPdfData): Promise<Buffer> {
  ensureFonts();
  return renderToBuffer(<ConsentDocument d={d} />);
}
