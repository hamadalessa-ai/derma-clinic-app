import { getTranslations } from "next-intl/server";
import { FileLock2 } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { requirePermission } from "@/lib/auth/session";

// Placeholder: real notes arrive in Phase 2. The guard is already enforced.
export default async function ClinicalNotesPage() {
  await requirePermission("clinical_notes:read");
  const t = await getTranslations("clinicalNotes");
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <Card>
        <CardContent className="flex items-center gap-3 pt-5">
          <FileLock2 className="text-brand size-6" />
          <p>{t("placeholder")}</p>
        </CardContent>
      </Card>
    </div>
  );
}
