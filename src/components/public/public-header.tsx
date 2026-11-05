import type { ReactNode } from "react";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";
import { withTenant } from "@/db/tenant";
import { getSettings } from "@/lib/booking/engine";
import { getCurrentTenant } from "@/lib/tenant/current";

/**
 * Header of the public pages (/book, /my, /sign, /visit): the clinic's own logo (linking back to
 * its website), language, and ONE slim demo notice — so moving from the website into booking
 * feels like the same place.
 */
export async function PublicHeader({
  clinicName,
  demoMode,
  toggle,
}: {
  clinicName: string;
  /** Text of the "demo mode" label, or null when codes are really sent. */
  demoMode: string | null;
  toggle: ReactNode;
}) {
  const t = await getTranslations("app");
  const tenant = await getCurrentTenant();
  const logo = tenant
    ? await withTenant(tenant.id, async (tx) => (await getSettings(tx)).site?.images?.logo ?? null)
    : null;
  return (
    <header className="bg-card shadow-soft sticky top-0 z-30">
      <div className="bg-site-champagne-soft text-site-champagne-ink flex items-center justify-center gap-1.5 px-4 py-1.5 text-center text-[11px] font-medium">
        <FlaskConical className="size-3.5 shrink-0" aria-hidden />
        <span>{t("demoBanner")}</span>
        {demoMode && (
          <span data-testid="demo-mode" role="note">
            · {demoMode}
          </span>
        )}
      </div>
      <div className="mx-auto flex h-16 max-w-3xl items-center gap-3 px-4">
        <Link href="/" className="flex min-w-0 flex-1 items-center gap-3" aria-label={clinicName}>
          {logo ? (
            // eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo, any host
            <img src={logo} alt={clinicName} className="h-9 w-auto" />
          ) : (
            <>
              <span className="bg-brand text-brand-foreground flex size-9 shrink-0 items-center justify-center rounded-full font-bold">
                {clinicName.charAt(0)}
              </span>
              <span className="text-brand-strong truncate font-semibold">{clinicName}</span>
            </>
          )}
        </Link>
        {toggle}
      </div>
    </header>
  );
}
