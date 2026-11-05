"use client";

import { useRef, useState } from "react";
import { MoveHorizontal } from "lucide-react";

/**
 * Before & after: drag (or use the arrow keys) to reveal. Shows the clinic's own result photos;
 * without them, two labelled frames so the interaction can be tried.
 */
export function BeforeAfter({
  before,
  after,
  labels,
}: {
  before?: string;
  after?: string;
  labels: { before: string; after: string; drag: string; placeholder: string };
}) {
  const [pos, setPos] = useState(50);
  const box = useRef<HTMLDivElement>(null);
  const move = (clientX: number) => {
    const r = box.current?.getBoundingClientRect();
    if (!r) return;
    setPos(Math.min(100, Math.max(0, ((clientX - r.left) / r.width) * 100)));
  };

  const frame = (src: string | undefined, label: string, tint: string) =>
    src ? (
      // eslint-disable-next-line @next/next/no-img-element -- the clinic's own result photos
      <img src={src} alt={label} className="h-full w-full object-cover" draggable={false} />
    ) : (
      <div className={`flex h-full w-full items-center justify-center ${tint}`}>
        <span className="text-site-subtle text-sm">{labels.placeholder}</span>
      </div>
    );

  return (
    <div
      ref={box}
      dir="ltr"
      className="shadow-soft relative aspect-[16/10] w-full touch-none overflow-hidden rounded-2xl select-none"
      onPointerDown={(e) => {
        (e.target as HTMLElement).setPointerCapture?.(e.pointerId);
        move(e.clientX);
      }}
      onPointerMove={(e) => e.buttons === 1 && move(e.clientX)}
      data-testid="before-after"
    >
      <div className="absolute inset-0">{frame(after, labels.after, "bg-site-primary-soft")}</div>
      <div className="absolute inset-0" style={{ clipPath: `inset(0 ${100 - pos}% 0 0)` }}>
        {frame(before, labels.before, "bg-site-champagne-soft")}
      </div>
      <span className="bg-card/90 text-site-ink absolute start-4 top-4 rounded-full px-3 py-1 text-xs font-semibold">
        {labels.before}
      </span>
      <span className="bg-card/90 text-site-ink absolute end-4 top-4 rounded-full px-3 py-1 text-xs font-semibold">
        {labels.after}
      </span>
      <div className="bg-card absolute inset-y-0 w-0.5" style={{ left: `${pos}%` }} aria-hidden />
      <button
        type="button"
        role="slider"
        aria-label={labels.drag}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(pos)}
        onKeyDown={(e) => {
          if (e.key === "ArrowLeft") setPos((p) => Math.max(0, p - 5));
          if (e.key === "ArrowRight") setPos((p) => Math.min(100, p + 5));
        }}
        className="bg-card text-site-primary shadow-float absolute top-1/2 flex size-12 -translate-x-1/2 -translate-y-1/2 cursor-ew-resize items-center justify-center rounded-full"
        style={{ left: `${pos}%` }}
      >
        <MoveHorizontal className="size-5" aria-hidden />
      </button>
    </div>
  );
}
