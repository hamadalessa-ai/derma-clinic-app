"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useLocale } from "next-intl";
import { ChevronLeft, ChevronRight, MapPin } from "lucide-react";
import { cn } from "@/lib/utils";

export interface DoctorCard {
  name: string;
  title: string;
  dept: string;
  branch: string | null;
  photo: string;
  /** A clean cut-out portrait exists ("photo" is empty when the clinic has none). */
  portrait: boolean;
  book: { href: string; external: boolean; label: string };
}

/**
 * The medical team on one line: the doctor in the middle is in focus (details and Book),
 * neighbours sit smaller on each side. Arrows, swipe, keyboard or a tap on a side card move
 * along; the department filter narrows the list.
 */
export function SiteDoctors({
  doctors,
  depts,
  labels,
}: {
  doctors: DoctorCard[];
  depts: { key: string; name: string }[];
  labels: { all: string; prev: string; next: string };
}) {
  const rtl = useLocale() === "ar";
  const [dept, setDept] = useState("all");
  const [center, setCenter] = useState(0);
  const startX = useRef<number | null>(null);
  const list = doctors.filter((d) => dept === "all" || d.dept === dept);
  const count = list.length;
  const go = (step: number) => count && setCenter((c) => (c + step + count) % count);
  /** Position of card i relative to the centre, wrapping around both ways. */
  const offsetOf = (i: number) => {
    let o = i - center;
    if (o > count / 2) o -= count;
    if (o < -count / 2) o += count;
    return o;
  };

  const arrow =
    "bg-site-ivory text-site-ink border-site-line hover:border-site-ink absolute top-[42%] z-20 flex size-11 -translate-y-1/2 items-center justify-center border transition-colors";

  return (
    <div className="flex flex-col gap-8">
      <div className="flex flex-wrap justify-center gap-x-7 gap-y-2" role="tablist">
        {[{ key: "all", name: labels.all }, ...depts].map((d) => (
          <button
            key={d.key}
            type="button"
            role="tab"
            aria-selected={dept === d.key}
            onClick={() => {
              setDept(d.key);
              setCenter(0);
            }}
            className={cn(
              "h-10 border-b text-sm tracking-wide transition-colors",
              dept === d.key
                ? "border-site-ink text-site-ink"
                : "text-site-subtle hover:text-site-ink border-transparent",
            )}
          >
            {d.name}
          </button>
        ))}
      </div>

      <div
        className="relative h-[34rem] overflow-hidden outline-none sm:h-[35rem]"
        role="region"
        aria-roledescription="carousel"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === "ArrowRight") go(rtl ? -1 : 1);
          if (e.key === "ArrowLeft") go(rtl ? 1 : -1);
        }}
        onPointerDown={(e) => (startX.current = e.clientX)}
        onPointerUp={(e) => {
          if (startX.current === null) return;
          const dx = e.clientX - startX.current;
          startX.current = null;
          if (Math.abs(dx) > 40) go((dx < 0 ? 1 : -1) * (rtl ? -1 : 1));
        }}
        data-testid="doctor-carousel"
      >
        {list.map((d, i) => {
          const o = offsetOf(i);
          const far = Math.abs(o);
          const visible = far <= 2;
          const focus = o === 0;
          return (
            <div
              key={d.name}
              className="absolute top-0 left-1/2 w-64 transition-[transform,opacity] duration-500 ease-out sm:w-72"
              style={{
                transform: `translateX(calc(-50% + ${(rtl ? -o : o) * 82}%)) scale(${focus ? 1 : far === 1 ? 0.84 : 0.7})`,
                opacity: visible ? (focus ? 1 : far === 1 ? 0.7 : 0.35) : 0,
                zIndex: 10 - far,
                pointerEvents: visible ? "auto" : "none",
              }}
              aria-hidden={!focus}
            >
              <article
                className={cn(
                  "bg-site-ivory flex flex-col overflow-hidden",
                  !focus && "cursor-pointer",
                )}
                onClick={() => !focus && setCenter(i)}
                data-testid={focus ? "site-doctor" : undefined}
              >
                <div className="bg-site-mist aspect-[4/5] overflow-hidden">
                  {d.photo ? (
                    // eslint-disable-next-line @next/next/no-img-element -- the clinic's own photos
                    <img
                      src={d.photo}
                      alt={d.name}
                      loading={far <= 2 ? "eager" : "lazy"}
                      draggable={false}
                      className="h-full w-full object-contain object-bottom pt-4"
                    />
                  ) : (
                    <div className="flex h-full items-center justify-center" aria-hidden>
                      <span className="font-display text-site-subtle text-7xl">
                        {d.name.replace(/^(د\.|Dr\.?|Prof\.\s*Dr\.?)\s*/i, "").charAt(0)}
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex flex-col gap-2 px-2 py-5 text-center">
                  <h3 className="font-display text-site-ink text-xl leading-snug font-normal">
                    {d.name}
                  </h3>
                  <p className="text-site-subtle text-[13px] leading-snug">{d.title}</p>
                  <div className={cn("flex flex-col gap-3 pt-1", !focus && "invisible")}>
                    {d.branch && (
                      <p className="text-site-subtle flex items-center justify-center gap-1 text-xs">
                        <MapPin className="size-3" aria-hidden />
                        {d.branch}
                      </p>
                    )}
                    {d.book.external ? (
                      <a
                        href={d.book.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        tabIndex={focus ? 0 : -1}
                        className="site-link self-center"
                      >
                        {d.book.label}
                      </a>
                    ) : (
                      <Link
                        href={d.book.href}
                        tabIndex={focus ? 0 : -1}
                        className="site-link self-center"
                        data-testid="doctor-book"
                      >
                        {d.book.label}
                      </Link>
                    )}
                  </div>
                </div>
              </article>
            </div>
          );
        })}

        {count > 1 && (
          <>
            <button
              type="button"
              aria-label={labels.prev}
              onClick={() => go(-1)}
              className={cn(arrow, "start-2 sm:start-6")}
            >
              {rtl ? <ChevronRight className="size-5" /> : <ChevronLeft className="size-5" />}
            </button>
            <button
              type="button"
              aria-label={labels.next}
              onClick={() => go(1)}
              className={cn(arrow, "end-2 sm:end-6")}
            >
              {rtl ? <ChevronLeft className="size-5" /> : <ChevronRight className="size-5" />}
            </button>
          </>
        )}
      </div>

      {count > 1 && (
        <p className="text-site-subtle text-center text-sm" dir="ltr" aria-live="polite">
          {center + 1} / {count}
        </p>
      )}
    </div>
  );
}
