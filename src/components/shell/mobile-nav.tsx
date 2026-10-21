"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import { Menu } from "lucide-react";
import { Dialog } from "@/components/ui/dialog";
import { splitForMobile } from "@/lib/auth/permissions";
import { cn } from "@/lib/utils";
import { NAV_ICONS } from "./nav-links";

type Item = { href: string; key: keyof typeof NAV_ICONS; label: string };

function isActive(pathname: string, href: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Phone navigation: a bottom bar (thumb reach) with the most-used pages for this role, plus
 * "More" for the rest. It receives exactly the same allowed items as the desktop sidebar.
 */
export function MobileNav({ items }: { items: Item[] }) {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const { bar, more } = splitForMobile(items);
  const moreActive = more.some((i) => isActive(pathname, i.href));

  const tab = (active: boolean) =>
    cn(
      "flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-1 py-1.5 text-[11px] leading-tight font-medium",
      active ? "text-brand" : "text-muted-foreground",
    );

  return (
    <>
      <nav
        aria-label={t("mainMenu")}
        data-testid="mobile-nav"
        className="bg-card fixed inset-x-0 bottom-0 z-20 border-t pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <div className="flex h-16 items-stretch">
          {bar.map((item) => {
            const Icon = NAV_ICONS[item.key];
            const active = isActive(pathname, item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? "page" : undefined}
                className={tab(active)}
              >
                <span
                  className={cn(
                    "flex h-7 w-12 items-center justify-center rounded-full",
                    active && "bg-accent",
                  )}
                >
                  <Icon className="size-5" />
                </span>
                <span className="line-clamp-2 text-center">{item.label}</span>
              </Link>
            );
          })}
          {more.length > 0 && (
            <button
              type="button"
              className={tab(moreActive)}
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={open}
            >
              <span
                className={cn(
                  "flex h-7 w-12 items-center justify-center rounded-full",
                  moreActive && "bg-accent",
                )}
              >
                <Menu className="size-5" />
              </span>
              <span>{t("more")}</span>
            </button>
          )}
        </div>
      </nav>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title={t("more")}
        closeLabel={tc("close")}
        placement="bottom"
      >
        <nav aria-label={t("more")} data-testid="mobile-more">
          <ul className="flex flex-col gap-1">
            {more.map((item) => {
              const Icon = NAV_ICONS[item.key];
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={() => setOpen(false)}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex min-h-12 items-center gap-3 rounded-md px-3 text-base font-medium",
                      active ? "bg-brand text-brand-foreground" : "hover:bg-accent",
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </Dialog>
    </>
  );
}
