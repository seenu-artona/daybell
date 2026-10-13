"use client";

import { type CSSProperties, useEffect, useRef, useState } from "react";
import { cn } from "../lib/cn";
import { prefersReducedMotion } from "../lib/motion";

export interface ConfettiBurstProps {
  /** Called once the burst is over (or straight away when motion is reduced), so the parent can unmount it. */
  onDone?: () => void;
  className?: string;
}

/** How long the burst lasts: 1–2 seconds (D75). */
export const CONFETTI_MS = 1500;
const PIECES = 40;
/** Colours from the design tokens only (D112): never a raw value. */
const TONES = ["bg-primary", "bg-lime", "bg-info", "bg-warning"] as const;

/** Where each piece flies: spread all round, falling a little; fixed per index so every burst looks the same. */
const pieces = Array.from({ length: PIECES }, (_, i) => {
  const angle = (i / PIECES) * Math.PI * 2 + ((i * 7) % 5) * 0.05;
  const distance = 140 + ((i * 37) % 180);
  return {
    x: Math.round(Math.cos(angle) * distance),
    y: Math.round(Math.sin(angle) * distance * 0.7 + 160),
    rotate: 360 + ((i * 67) % 360),
    delay: (i * 13) % 120,
    tone: TONES[i % TONES.length],
    wide: i % 3 === 0,
  };
});

/**
 * A 1.5-second confetti burst over the whole page for a real win (D75: a job goes live). CSS only, no dependency:
 * about 40 small pieces in token colours, hidden from assistive technology and never in the way of a click. With
 * reduced motion asked for, nothing is drawn at all (D91). Say what happened in words elsewhere (a live region); this
 * is decoration only.
 */
export function ConfettiBurst({ onDone, className }: ConfettiBurstProps) {
  const [show, setShow] = useState(false);
  const done = useRef(onDone);
  done.current = onDone;

  useEffect(() => {
    if (prefersReducedMotion()) {
      done.current?.();
      return;
    }
    setShow(true);
    const id = window.setTimeout(() => {
      setShow(false);
      done.current?.();
    }, CONFETTI_MS + 150);
    return () => window.clearTimeout(id);
  }, []);

  if (!show) return null;
  return (
    <div
      aria-hidden="true"
      data-confetti=""
      className={cn(
        "pointer-events-none fixed inset-0 z-50 overflow-hidden motion-reduce:hidden",
        className,
      )}
    >
      {pieces.map((p, i) => (
        <span
          // The pieces never change order; the index is their identity.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list.
          key={i}
          className={cn(
            "absolute top-[28%] left-1/2 block rounded-[2px] opacity-0 animate-[daybell-confetti_1500ms_var(--ease-out)_forwards]",
            p.wide ? "h-1.5 w-3" : "h-2.5 w-2",
            p.tone,
          )}
          style={
            {
              "--confetti-x": `${p.x}px`,
              "--confetti-y": `${p.y}px`,
              "--confetti-r": `${p.rotate}deg`,
              animationDelay: `${p.delay}ms`,
            } as CSSProperties
          }
        />
      ))}
    </div>
  );
}
