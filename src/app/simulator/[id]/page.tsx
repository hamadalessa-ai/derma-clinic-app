import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getLocale } from "next-intl/server";
import { AutoRefresh } from "@/components/clinic/auto-refresh";
import { SimulatorPhone } from "@/components/whatsapp/simulator";
import { withActor } from "@/lib/auth/db";
import { actorOf, requirePermission } from "@/lib/auth/session";
import { brandStyle, pick } from "@/lib/brand";
import { whatsappMode } from "@/lib/whatsapp/config";
import { getThread } from "@/lib/whatsapp/staff";
import { messageView } from "@/lib/whatsapp/view";
import type { Locale } from "@/i18n/config";

/** The AI receptionist may take several seconds (a few model calls) to answer a message. */
export const maxDuration = 60;

export const metadata: Metadata = { title: "WhatsApp" };

/** Demo: the patient's phone, full screen (to show on a real phone during a demo). */
export default async function PatientViewPage({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requirePermission("whatsapp:simulator");
  const { id } = await params;
  if (whatsappMode(ctx.tenant) !== "demo" || !/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const locale = (await getLocale()) as Locale;
  const thread = await withActor(actorOf(ctx), (tx) => getThread(tx, id));
  if (!thread) notFound();
  return (
    <div style={brandStyle(ctx.tenant.brandColor)} className="mx-auto w-full max-w-md">
      <SimulatorPhone
        fullScreen
        conversationId={thread.conversation.id}
        phone={thread.conversation.phone}
        clinicName={pick(locale, ctx.tenant.nameAr, ctx.tenant.nameEn)}
        messages={thread.messages.map((m) => messageView(m, locale))}
        backHref={`/whatsapp/simulator?c=${id}`}
      />
      <AutoRefresh versionUrl="/api/whatsapp/version" intervalMs={4000} />
    </div>
  );
}
