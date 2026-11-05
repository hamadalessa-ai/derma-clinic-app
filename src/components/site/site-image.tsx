import { ImageIcon } from "lucide-react";
import { SITE_IMAGE_SLOTS, type ImageSlot, type ImageSlotKey } from "@/lib/site/images";
import { cn } from "@/lib/utils";

/**
 * One photo on the clinic website. With the clinic's photo set for this slot it is a plain
 * <img> (object-cover, descriptive alt). Without it, a calm frame that names the slot, what the
 * photo should show and the file it expects, so the clinic knows exactly what to supply.
 */
export function SiteImage({
  slot,
  spec,
  src,
  locale,
  className,
  placeholderClassName,
  fit = "cover",
  showSpec = true,
  priority = false,
}: {
  slot: ImageSlotKey | string;
  /** For slots not in SITE_IMAGE_SLOTS (e.g. a doctor's portrait). */
  spec?: ImageSlot;
  src?: string;
  locale: "ar" | "en";
  className?: string;
  /** Extra classes for the empty frame only (e.g. where its label sits). */
  placeholderClassName?: string;
  /** "contain" for logos and artwork that must not be cropped. */
  fit?: "cover" | "contain";
  showSpec?: boolean;
  priority?: boolean;
}) {
  const s = spec ?? SITE_IMAGE_SLOTS[slot as ImageSlotKey];
  const alt = locale === "ar" ? s.altAr : s.altEn;
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- clinic photos may live on any host
      <img
        src={src}
        alt={alt}
        className={cn(
          "h-full w-full",
          fit === "contain" ? "object-contain" : "object-cover",
          className,
        )}
        loading={priority ? "eager" : "lazy"}
        fetchPriority={priority ? "high" : undefined}
        data-slot={slot}
      />
    );
  }
  return (
    <div
      role="img"
      aria-label={alt}
      data-slot={slot}
      className={cn(
        "from-site-mist via-site-primary-soft to-site-mist relative flex h-full w-full items-center justify-center overflow-hidden bg-linear-to-br",
        className,
        placeholderClassName,
      )}
    >
      <div
        className="border-site-primary/15 absolute inset-4 rounded-[inherit] border border-dashed"
        aria-hidden
      />
      <div className="text-site-subtle relative flex max-w-[80%] flex-col items-center gap-2 text-center">
        <ImageIcon className="text-site-primary/40 size-8" aria-hidden />
        <span className="text-site-slate text-sm font-medium">{alt}</span>
        {showSpec && (
          <span className="font-mono text-[11px]" dir="ltr">
            {s.file} · {s.size}
          </span>
        )}
      </div>
    </div>
  );
}
