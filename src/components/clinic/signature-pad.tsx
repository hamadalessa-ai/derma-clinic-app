"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  /** PNG as a data URL, or null if nothing was drawn. */
  toPng(): string | null;
  clear(): void;
}

/** One stroke = points as fractions (0–1) of the pad's width/height, so it survives resizing. */
type Stroke = { x: number; y: number }[];

/**
 * Finger / pen / mouse signature on a canvas, for phones and tablets (portrait or landscape).
 *  - re-measures whenever its size changes (rotation, opening in a dialog) and redraws the
 *    signature, at the screen's pixel density, so the ink is always under the finger;
 *  - the page never scrolls while signing (touch-action: none + non-passive touch listeners,
 *    which iPad Safari needs);
 *  - one pointer at a time (a resting palm doesn't draw); a cancelled touch ends the stroke.
 */
export function SignaturePad({
  ref,
  clearLabel,
  hint,
}: {
  ref?: Ref<SignaturePadHandle>;
  clearLabel: string;
  hint: string;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const strokes = useRef<Stroke[]>([]);
  const active = useRef<number | null>(null);
  const [empty, setEmpty] = useState(true);

  /** Draws all strokes at the canvas's current size. */
  function redraw() {
    const c = canvas.current;
    if (!c) return;
    const ctx = c.getContext("2d")!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color; // ink colour from the theme (text-foreground)
    const w = c.clientWidth;
    const h = c.clientHeight;
    for (const s of strokes.current) {
      if (!s.length) continue;
      ctx.beginPath();
      ctx.moveTo(s[0].x * w, s[0].y * h);
      if (s.length === 1) ctx.lineTo(s[0].x * w + 0.1, s[0].y * h + 0.1);
      for (const p of s.slice(1)) ctx.lineTo(p.x * w, p.y * h);
      ctx.stroke();
    }
  }

  useEffect(() => {
    const c = canvas.current!;
    // Match the drawing surface to the shown size × pixel density, now and on every resize.
    const fit = () => {
      const ratio = Math.max(window.devicePixelRatio || 1, 1);
      const w = Math.round(c.clientWidth * ratio);
      const h = Math.round(c.clientHeight * ratio);
      if (w > 0 && h > 0 && (c.width !== w || c.height !== h)) {
        c.width = w;
        c.height = h;
      }
      redraw();
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(c);
    window.addEventListener("orientationchange", fit);
    // iPad Safari may still scroll on touch; non-passive listeners can stop it.
    const stop = (e: TouchEvent) => e.preventDefault();
    c.addEventListener("touchstart", stop, { passive: false });
    c.addEventListener("touchmove", stop, { passive: false });
    return () => {
      observer.disconnect();
      window.removeEventListener("orientationchange", fit);
      c.removeEventListener("touchstart", stop);
      c.removeEventListener("touchmove", stop);
    };
  }, []);

  const clear = () => {
    strokes.current = [];
    active.current = null;
    redraw();
    setEmpty(true);
  };

  useImperativeHandle(ref, () => ({
    toPng: () => (empty ? null : canvas.current!.toDataURL("image/png")),
    clear,
  }));

  /** Pointer position as a fraction of the drawing area (inside the border). */
  function point(e: { clientX: number; clientY: number }) {
    const c = canvas.current!;
    const rect = c.getBoundingClientRect();
    const x = (e.clientX - rect.left - c.clientLeft) / c.clientWidth;
    const y = (e.clientY - rect.top - c.clientTop) / c.clientHeight;
    return { x: Math.min(1, Math.max(0, x)), y: Math.min(1, Math.max(0, y)) };
  }

  function end(e: React.PointerEvent<HTMLCanvasElement>) {
    if (active.current !== e.pointerId) return;
    active.current = null;
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        data-testid="signature-pad"
        data-empty={empty}
        aria-label={hint}
        className="border-input bg-card text-foreground h-40 w-full touch-none overscroll-contain rounded-md border-2 border-dashed select-none sm:h-48"
        onPointerDown={(e) => {
          if (active.current !== null) return; // a second finger / palm: ignore
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          active.current = e.pointerId;
          e.currentTarget.setPointerCapture(e.pointerId);
          strokes.current.push([point(e)]);
          redraw();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (active.current !== e.pointerId) return;
          e.preventDefault();
          const stroke = strokes.current[strokes.current.length - 1];
          // Coalesced events: every point the device reported, for smooth fast strokes.
          const events = e.nativeEvent.getCoalescedEvents?.() ?? [];
          for (const ev of events.length ? events : [e]) stroke.push(point(ev));
          redraw();
        }}
        onPointerUp={end}
        onPointerCancel={end}
        onLostPointerCapture={end}
      />
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{hint}</span>
        <Button type="button" variant="ghost" size="sm" onClick={clear}>
          <Eraser />
          {clearLabel}
        </Button>
      </div>
    </div>
  );
}
