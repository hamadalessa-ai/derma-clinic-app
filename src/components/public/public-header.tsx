import type { ReactNode } from "react";
import { getTranslations } from "next-intl/server";
import { FlaskConical } from "lucide-react";

/** Header of the public pages (/book, /my): clinic name, language, demo notices. */
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
  return (
    <header>
      <div className="bg-warning text-warning-foreground px-4 py-1.5 text-center text-xs font-medium">
        {t("demoBanner")}
      </div>
      {demoMode && (
        <div
          className="bg-info text-info-foreground flex items-center justify-center gap-2 px-4 py-1.5 text-center text-xs font-medium"
          data-testid="demo-mode"
          role="note"
        >
          <FlaskConical className="size-3.5 shrink-0" aria-hidden />
          {demoMode}
        </div>
      )}
      <div className="bg-card flex items-center gap-3 border-b px-4 py-3">
        <div className="bg-brand text-brand-foreground flex size-9 shrink-0 items-center justify-center rounded-full font-bold">
          {clinicName.charAt(0)}
        </div>
        <div className="text-brand-strong min-w-0 flex-1 truncate font-semibold">{clinicName}</div>
        {toggle}
      </div>
    </header>
  );
}
