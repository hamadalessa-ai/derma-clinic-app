import { NextResponse } from "next/server";
import { loadConsentRecord } from "@/lib/consents/record";
import { renderConsentPdf } from "@/lib/pdf/consent-pdf";

export const runtime = "nodejs";

/** The signed consent as a PDF (a view of the official database record). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const r = await loadConsentRecord(id);
  if (!r || !r.signature) return NextResponse.json({ error: "not found" }, { status: 404 });
  const c = r.consent;
  const pdf = await renderConsentPdf({
    clinicNameAr: r.tenant.nameAr,
    clinicNameEn: r.tenant.nameEn,
    titleAr: c.titleAr,
    titleEn: c.titleEn,
    bodyAr: c.bodyAr,
    bodyEn: c.bodyEn,
    patientNameAr: r.patient.fullNameAr,
    patientNameEn: r.patient.fullNameEn,
    fileNumber: r.patient.fileNumber,
    signerName: c.signerName,
    signerRelationAr: c.signerRelation === "guardian" ? "وليّ الأمر" : "المريض نفسه",
    witnessName: r.witnessName,
    signedAtAr: r.signedAtAr,
    signedAtEn: r.signedAtEn,
    templateCode: c.templateCode,
    templateVersion: c.templateVersion,
    fingerprint: c.contentSha256,
    intact: r.intact,
    signaturePng: r.signature.data,
  });
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="consent-${r.patient.fileNumber}-${c.templateCode}-v${c.templateVersion}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
