import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { Notice } from "@/components/ui/notice";
import { PageHeader } from "@/components/ui/page-header";
import { NewPatientForm } from "@/components/clinic/new-patient-form";
import { requirePermission } from "@/lib/auth/session";

export default async function NewPatientPage() {
  await requirePermission("patients:edit");
  const t = await getTranslations("patientsX");
  const ta = await getTranslations("app");
  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <PageHeader title={t("new")} />
      <Notice tone="warning">{ta("demoBanner")}</Notice>
      <Card>
        <CardContent className="pt-5">
          <NewPatientForm />
        </CardContent>
      </Card>
    </div>
  );
}
