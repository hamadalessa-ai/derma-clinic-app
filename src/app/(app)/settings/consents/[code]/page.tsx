import { notFound } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { ConsentRuleEditor, TemplateEditor } from "@/components/clinic/settings-forms";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { consentRulesByCode, currentTemplate } from "@/lib/consents/consents";

export default async function EditConsentTemplatePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const ctx = await requirePermission("consents:templates");
  const { code } = await params;
  if (!/^[a-z_]{2,40}$/.test(code)) notFound();
  const t = await getTranslations("settings");
  const tr = await getTranslations("consentRules");
  const { tpl, rule } = await withActor(actorOf(ctx), async (tx) => ({
    tpl: await currentTemplate(tx, code),
    rule: (await consentRulesByCode(tx)).get(code) ?? {
      rule: "every_visit" as const,
      months: null,
    },
  }));
  if (!tpl) notFound();
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title={t("editTemplate")}
        subtitle={t("currentVersion", { version: tpl.version })}
      />
      <Card>
        <CardHeader>
          <CardTitle>{tr("title")}</CardTitle>
        </CardHeader>
        <CardContent>
          <ConsentRuleEditor key={`${rule.rule}-${rule.months}`} code={code} initial={rule} />
        </CardContent>
      </Card>
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
