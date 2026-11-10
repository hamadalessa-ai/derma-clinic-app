import { getTranslations } from "next-intl/server";
import { PatientImport } from "@/components/clinic/patient-import";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";

/** Patients → Import from a spreadsheet (clinic admin). */
export default async function PatientImportPage() {
  const ctx = await requirePermission("patients:import");
  const t = await getTranslations("patientImport");
  return (
    <div className="flex max-w-3xl flex-col gap-4">
      <PageHeader title={t("title")} subtitle={t("subtitle")} />
      {ctx.tenant.isDemo && <Notice tone="warning">{t("demoOnlyFake")}</Notice>}
      <PatientImport />
    </div>
  );
}
