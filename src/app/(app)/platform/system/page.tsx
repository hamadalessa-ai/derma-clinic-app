import { CheckCircle2, CircleAlert, Info, XCircle } from "lucide-react";
import { getTranslations } from "next-intl/server";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { requirePermission } from "@/lib/auth/session";
import { platformOverview } from "@/lib/platform/overview";
import { opsRecords, statusChecks, type CheckState } from "@/lib/platform/system-status";

const ICON: Record<CheckState, typeof Info> = {
  ok: CheckCircle2,
  warn: CircleAlert,
  bad: XCircle,
  info: Info,
};
const TONE: Record<CheckState, string> = {
  ok: "text-success-foreground",
  warn: "text-warning-foreground",
  bad: "text-destructive",
  info: "text-muted-foreground",
};

/** Is this installation ready for real clinics? Settings and ops records only, no clinic data. */
export default async function SystemStatusPage() {
  await requirePermission("platform:read");
  const t = await getTranslations("systemStatus");
  const [ops, clinics] = await Promise.all([opsRecords(), platformOverview()]);
  const checks = statusChecks(ops, clinics.filter((c) => c.tenant.isDemo).length);
  return (
    <div className="flex max-w-2xl flex-col gap-4">
      <PageHeader title={t("title")} />
      <p className="text-muted-foreground text-sm">{t("intro")}</p>
      <Card>
        <CardContent className="divide-y pt-2" data-testid="system-status">
          {checks.map((c, i) => {
            const Icon = ICON[c.state];
            return (
              <div key={`${c.key}-${i}`} className="flex items-start gap-3 py-3 text-sm">
                <Icon className={`mt-0.5 size-4 shrink-0 ${TONE[c.state]}`} aria-hidden />
                <span>{t(`check.${c.key}`, c.values ?? {})}</span>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
