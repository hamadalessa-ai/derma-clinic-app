import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Notice } from "@/components/ui/notice";
import { brandStyle } from "@/lib/brand";
import { loadConsentRecord } from "@/lib/consents/record";
import { PrintButton } from "./print-button";

/**
 * Print-friendly view of the OFFICIAL signed consent record. The browser renders Arabic
 * perfectly, so "Print / Save as PDF" from here always gives a correct document.
 */
export default async function ConsentPrintPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadConsentRecord(id);
  if (!r) notFound();
  const t = await getTranslations("consent");
  const ta = await getTranslations("app");
  const c = r.consent;
  const sig = r.signature
    ? `data:${r.signature.mimeType};base64,${r.signature.data.toString("base64")}`
    : null;

  return (
    <div style={brandStyle(r.tenant.brandColor)} className="bg-card print:bg-card min-h-screen">
      <div
        className="mx-auto flex max-w-3xl flex-col gap-5 p-6 text-sm leading-7 print:max-w-none print:p-0"
        data-testid="consent-print"
      >
        <div className="flex items-center justify-between gap-3 print:hidden">
          <Notice tone="info" className="flex-1">
            {t("officialRecord")}
          </Notice>
          <PrintButton label={t("printNow")} />
        </div>

        <header className="flex items-center justify-between border-b pb-3">
          <div className="text-brand-strong text-lg font-bold">{r.tenant.nameAr}</div>
          <div className="text-brand-strong text-lg font-bold" dir="ltr">
            {r.tenant.nameEn}
          </div>
        </header>

        <section dir="rtl" className="flex flex-col gap-1">
          <h1 className="text-xl font-bold">{c.titleAr}</h1>
          <p>
            المريض: {r.patient.fullNameAr} – رقم الملف <span dir="ltr">{r.patient.fileNumber}</span>
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {c.bodyAr.split(/\n+/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </section>

        <section dir="ltr" className="flex flex-col gap-1 border-t pt-4 text-start">
          <h2 className="text-lg font-bold">{c.titleEn}</h2>
          <p>
            Patient: {r.patient.fullNameEn ?? r.patient.fullNameAr} – File {r.patient.fileNumber}
          </p>
          <div className="mt-2 flex flex-col gap-2">
            {c.bodyEn.split(/\n+/).map((para, i) => (
              <p key={i}>{para}</p>
            ))}
          </div>
        </section>

        <section className="grid gap-4 border-t pt-4 sm:grid-cols-2 print:grid-cols-2">
          <div className="flex flex-col gap-1">
            {/* eslint-disable-next-line @next/next/no-img-element -- inline data URL of the stored signature */}
            {sig && <img src={sig} alt={t("sign")} className="h-24 w-64 object-contain" />}
            <div>
              الموقّع: {c.signerName} (
              {c.signerRelation === "guardian" ? "وليّ الأمر" : "المريض نفسه"})
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <div>
              {t("witness")}: {r.witnessName}
            </div>
            <div>
              {t("signedOn")}: {r.signedAtAr}
            </div>
            <div dir="ltr" className="text-start">
              Signed: {r.signedAtEn}
            </div>
          </div>
        </section>

        <footer className="text-muted-foreground border-t pt-3 text-xs">
          <div dir="ltr" className="text-start">
            Template {c.templateCode} v{c.templateVersion} · {t("fingerprint")} SHA-256{" "}
            {c.contentSha256.slice(0, 16)}… · {r.intact ? t("intact") : t("altered")}
          </div>
          <div>{ta("demoBanner")}</div>
        </footer>
      </div>
    </div>
  );
}
