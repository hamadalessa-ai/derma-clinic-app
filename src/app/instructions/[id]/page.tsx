import { notFound } from "next/navigation";
import { getLocale, getTranslations } from "next-intl/server";
import { InstructionSheet } from "@/components/visits/instruction-sheet";
import { PrintButton } from "@/app/consents/[id]/print/print-button";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { brandStyle, pick } from "@/lib/brand";
import { instructionsData } from "@/lib/visits/checkout";
import type { Locale } from "@/i18n/config";

const UUID_RE = /^[0-9a-f-]{36}$/i;

/** Reception prints the patient's after-visit instructions at checkout (A4, no app chrome). */
export default async function InstructionsPrintPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const ctx = await requirePermission("visits:checkout");
  const { id } = await params;
  if (!UUID_RE.test(id)) notFound();
  const data = await withActor(actorOf(ctx), (tx) => instructionsData(tx, id));
  if (!data) notFound();
  const locale = (await getLocale()) as Locale;
  const t = await getTranslations("care");
  return (
    <div style={brandStyle(ctx.tenant.brandColor)} className="bg-card min-h-screen">
      <div className="mx-auto flex max-w-2xl flex-col gap-4 p-6 print:max-w-none print:p-0">
        <div className="flex justify-end print:hidden">
          <PrintButton label={t("print")} />
        </div>
        <InstructionSheet
          data={data}
          clinicName={pick(locale, ctx.tenant.nameAr, ctx.tenant.nameEn)}
          fullName
        />
      </div>
    </div>
  );
}
