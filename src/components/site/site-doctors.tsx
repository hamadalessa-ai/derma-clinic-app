"use client";

import { useState } from "react";
import Link from "next/link";
import { CalendarCheck, MapPin, MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DoctorCard {
  name: string;
  title: string;
  dept: string;
  branch: string | null;
  photo: string;
  book: { href: string; external: boolean; label: string };
}

/** The medical team: department filter, 4:5 portraits, credentials, and a Book button each. */
export function SiteDoctors({
  doctors,
  depts,
  labels,
}: {
  doctors: DoctorCard[];
  depts: { key: string; name: string }[];
  labels: { all: string; more: string };
}) {
  const [dept, setDept] = useState("all");
  const [all, setAll] = useState(false);
  const list = doctors.filter((d) => dept === "all" || d.dept === dept);
  const shown = all ? list : list.slice(0, 8);

  return (
    <div className="flex flex-col gap-10">
      <div className="flex flex-wrap gap-2" role="tablist">
        {[{ key: "all", name: labels.all }, ...depts].map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={dept === d.key}
            onClick={() => {
              setDept(d.key);
              setAll(false);
            }}
            className={cn(
              "h-11 rounded-full px-5 text-sm font-semibold transition-colors",
              dept === d.key
                ? "bg-site-primary text-site-ivory shadow-sm"
                : "bg-card text-site-slate shadow-sm hover:text-site-primary",
            )}
          >
            {d.name}
          </button>
        ))}
      </div>

      <ul className="grid grid-cols-2 gap-4 sm:gap-6 lg:grid-cols-4">
        {shown.map((d) => (
          <li
            key={d.name}
            className="bg-card shadow-soft flex flex-col overflow-hidden rounded-2xl"
            data-testid="site-doctor"
          >
            <div className="bg-site-mist aspect-[4/5] overflow-hidden">
              {/* eslint-disable-next-line @next/next/no-img-element -- the clinic's own photos */}
              <img
                src={d.photo}
                alt={d.name}
                loading="lazy"
                className="h-full w-full object-cover object-[78%_18%]"
              />
            </div>
            <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
              <div>
                <h3 className="font-display text-site-ink text-base leading-snug font-semibold sm:text-lg">
                  {d.name}
                </h3>
                <p className="text-site-primary mt-1 text-xs leading-snug font-medium sm:text-sm">
                  {d.title}
                </p>
              </div>
              {d.branch && (
                <p className="text-site-subtle flex items-center gap-1 text-xs">
                  <MapPin className="size-3" aria-hidden />
                  {d.branch}
                </p>
              )}
              {d.book.external ? (
                <a
                  href={d.book.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-site-primary/30 text-site-primary hover:bg-site-primary hover:text-site-ivory mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl border text-sm font-semibold transition-colors"
                >
                  <MessageCircle className="size-4" aria-hidden />
                  {d.book.label}
                </a>
              ) : (
                <Link
                  href={d.book.href}
                  className="bg-site-primary text-site-ivory hover:bg-site-primary-hover mt-auto inline-flex h-10 items-center justify-center gap-2 rounded-xl text-sm font-semibold transition-colors"
                  data-testid="doctor-book"
                >
                  <CalendarCheck className="size-4" aria-hidden />
                  {d.book.label}
                </Link>
              )}
            </div>
          </li>
        ))}
      </ul>

      {!all && list.length > 8 && (
        <button
          type="button"
          onClick={() => setAll(true)}
          className="bg-card text-site-primary hover:bg-site-primary hover:text-site-ivory mx-auto h-12 rounded-xl px-8 text-sm font-semibold shadow-sm transition-colors"
        >
          {labels.more.replace("#", String(list.length))}
        </button>
      )}
    </div>
  );
}
