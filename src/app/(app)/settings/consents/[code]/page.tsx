import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { TemplateEditor } from "@/components/clinic/settings-forms";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { currentTemplate } from "@/lib/consents/consents";

export default async function EditConsentTemplatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const ctx = await requirePermission("consents:templates");
  const { code } = await params;
  if (!/^[a-z_]{2,40}$/.test(code)) notFound();
  const t = await getTranslations("settings");
  const tpl = await withActor(actorOf(ctx), (tx) => currentTemplate(tx, code));
  if (!tpl) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("editTemplate")}
        subtitle={t("currentVersion", { version: tpl.version })}
      />
      <Card>
        <CardContent className="pt-5">
          <TemplateEditor
            key={tpl.id}
            code={code}
            initial={{
              titleAr: tpl.titleAr,
              titleEn: tpl.titleEn,
              bodyAr: tpl.bodyAr,
              bodyEn: tpl.bodyEn,
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}
