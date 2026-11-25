"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronDown } from "lucide-react";
import { NAV_ICONS } from "./nav-links";

type Item = { href: string; key: keyof typeof NAV_ICONS; label: string };

/**
 * The menu under the person's name (top right): My account, Help, language and Sign out —
 * the rare things, so the side menu keeps only daily pages. `footer` = the language switch and
 * the sign-out form (rendered by the server layout).
 */
export function UserMenu({
  name,
  role,
  label,
  items,
  footer,
}: {
  name: string;
  role: string;
  label: string;
  items: Item[];
  footer: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const locale = useLocale();
  // Close after the language changes (the page re-renders in the other direction).
  const [shownLocale, setShownLocale] = useState(locale);
  if (shownLocale !== locale) {
    setShownLocale(locale);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (
        e instanceof KeyboardEvent ? e.key === "Escape" : !box.current?.contains(e.target as Node)
      )
        setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  return (
    <div ref={box} className="relative" data-testid="user-menu">
      <button
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="hover:bg-accent flex items-center gap-2 rounded-lg px-2 py-1.5 text-start"
      >
        <span className="bg-brand-soft text-brand-strong flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold">
          {name.trim().charAt(0)}
        </span>
        <span className="hidden leading-tight sm:block">
          <span className="block max-w-40 truncate text-sm font-medium">{name}</span>
          <span className="text-muted-foreground block max-w-40 truncate text-xs">{role}</span>
        </span>
        <ChevronDown className="text-muted-foreground size-4" />
      </button>
      {open && (
        <div
          role="menu"
          className="bg-card shadow-card absolute end-0 top-full z-30 mt-1 w-60 rounded-xl border p-2"
        >
          <div className="border-b px-2 pb-2 sm:hidden">
            <div className="truncate text-sm font-medium">{name}</div>
            <div className="text-muted-foreground truncate text-xs">{role}</div>
          </div>
          <ul className="flex flex-col gap-0.5 py-1">
            {items.map((item) => {
              const Icon = NAV_ICONS[item.key];
              return (
                <li key={item.href}>
                  <Link
                    role="menuitem"
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className="hover:bg-accent flex min-h-10 items-center gap-3 rounded-lg px-2 text-sm font-medium"
                  >
                    <Icon className="text-muted-foreground size-4" />
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t pt-2">{footer}</div>
        </div>
      )}
    </div>
  );
}
