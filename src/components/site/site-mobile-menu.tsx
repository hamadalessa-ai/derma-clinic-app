"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { CalendarCheck, ChevronDown, Menu, Phone, X } from "lucide-react";
import { SiteLangSwitch } from "./site-lang-switch";

export interface MobileMenuGroup {
  label: string;
  links: { label: string; href: string }[];
}

/** The clinic website's menu on phones and tablets: a full-screen sheet with the same sections. */
export function SiteMobileMenu({
  groups,
  extra,
  book,
  phone,
  labels,
  logo = null,
  name = "",
}: {
  groups: MobileMenuGroup[];
  extra: { label: string; href: string }[];
  book: { label: string; href: string } | null;
  phone: { label: string; href: string } | null;
  labels: { open: string; close: string };
  logo?: string | null;
  name?: string;
}) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    document.body.style.overflow = open ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);
  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="border-site-line text-site-ink flex size-11 items-center justify-center rounded-xl border lg:hidden"
        aria-label={labels.open}
        aria-expanded={open}
        onClick={() => setOpen(true)}
        data-testid="site-menu"
      >
        <Menu className="size-5" />
      </button>
      {open &&
        // In <body>: the sticky header's backdrop blur would otherwise trap a fixed overlay.
        createPortal(
          <div
            className="bg-card font-site fixed inset-0 z-50 flex flex-col lg:hidden"
            role="dialog"
            aria-modal
          >
            <div className="border-site-line flex h-16 items-center justify-between gap-3 border-b px-5">
              {logo ? (
                // eslint-disable-next-line @next/next/no-img-element -- the clinic's own logo
                <img src={logo} alt={name} className="h-8 w-auto" />
              ) : (
                <span className="text-site-ink font-semibold">{name}</span>
              )}
              <div className="flex items-center gap-2">
                <SiteLangSwitch tone="light" className="text-site-slate" />
                <button
                  type="button"
                  className="text-site-ink flex size-11 items-center justify-center"
                  aria-label={labels.close}
                  onClick={close}
                >
                  <X className="size-6" />
                </button>
              </div>
            </div>
            <nav className="flex-1 overflow-y-auto px-5 py-2">
              {groups.map((g) => (
                <details key={g.label} className="border-site-line group border-b">
                  <summary className="text-site-ink flex cursor-pointer list-none items-center justify-between py-4 text-lg font-semibold [&::-webkit-details-marker]:hidden">
                    {g.label}
                    <ChevronDown className="size-5 transition-transform group-open:rotate-180" />
                  </summary>
                  <ul className="flex flex-col pb-3">
                    {g.links.map((l) => (
                      <li key={l.label}>
                        <a
                          href={l.href}
                          onClick={close}
                          className="text-site-slate block py-2 ps-3 text-[15px]"
                        >
                          {l.label}
                        </a>
                      </li>
                    ))}
                  </ul>
                </details>
              ))}
              {extra.map((l) => (
                <a
                  key={l.label}
                  href={l.href}
                  onClick={close}
                  className="border-site-line text-site-ink block border-b py-4 text-lg font-semibold"
                >
                  {l.label}
                </a>
              ))}
            </nav>
            <div className="border-site-line flex flex-col gap-2 border-t p-5">
              {book && (
                <Link
                  href={book.href}
                  onClick={close}
                  className="bg-site-primary text-site-ivory flex h-12 items-center justify-center gap-2 rounded-lg font-semibold"
                >
                  <CalendarCheck className="size-4" />
                  {book.label}
                </Link>
              )}
              {phone && (
                <a
                  href={phone.href}
                  className="border-site-line text-site-ink flex h-12 items-center justify-center gap-2 rounded-lg border font-medium"
                >
                  <Phone className="size-4" />
                  <span dir="ltr">{phone.label}</span>
                </a>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
