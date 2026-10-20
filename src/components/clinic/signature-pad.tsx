"use client";

import { useEffect, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  /** PNG as a data URL, or null if nothing was drawn. */
  toPng(): string | null;
  clear(): void;
}

/** Finger / stylus / mouse signature on a canvas. Works on tablets and phones. */
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
  const drawing = useRef(false);
  const [empty, setEmpty] = useState(true);

  useEffect(() => {
    const c = canvas.current!;
    const ratio = Math.max(window.devicePixelRatio || 1, 1);
    const rect = c.getBoundingClientRect();
    c.width = rect.width * ratio;
    c.height = rect.height * ratio;
    const ctx = c.getContext("2d")!;
    ctx.scale(ratio, ratio);
    ctx.lineWidth = 2.5;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = getComputedStyle(c).color; // ink colour from the theme (text-foreground)
  }, []);

  useImperativeHandle(ref, () => ({
    toPng: () => (empty ? null : canvas.current!.toDataURL("image/png")),
    clear: () => {
      const c = canvas.current!;
      c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
      setEmpty(true);
    },
  }));

  function point(e: React.PointerEvent<HTMLCanvasElement>) {
    const rect = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }

  return (
    <div className="flex flex-col gap-2">
      <canvas
        ref={canvas}
        data-testid="signature-pad"
        aria-label={hint}
        className="border-input bg-card text-foreground h-40 w-full touch-none rounded-md border-2 border-dashed"
        onPointerDown={(e) => {
          drawing.current = true;
          e.currentTarget.setPointerCapture(e.pointerId);
          const ctx = canvas.current!.getContext("2d")!;
          const p = point(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x + 0.1, p.y + 0.1);
          ctx.stroke();
          setEmpty(false);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvas.current!.getContext("2d")!;
          const p = point(e);
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
        }}
        onPointerUp={() => (drawing.current = false)}
        onPointerLeave={() => (drawing.current = false)}
      />
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>{hint}</span>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => {
            const c = canvas.current!;
            c.getContext("2d")!.clearRect(0, 0, c.width, c.height);
            setEmpty(true);
          }}
        >
          <Eraser />
          {clearLabel}
        </Button>
      </div>
    </div>
  );
}
