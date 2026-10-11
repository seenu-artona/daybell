"use client";

import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "../lib/cn";
import { prefersReducedMotion } from "../lib/motion";

export interface CelebrationProps {
  icon?: ReactNode;
  title: ReactNode;
  body?: ReactNode;
  action?: ReactNode;
  /** Change this number to fire the confetti again. */
  burst?: number;
  className?: string;
}

const CONFETTI_MS = 1600;
const PIECES = 90;
const PALETTE_VARS = ["--color-lime", "--color-primary", "--color-ink", "--color-warning"];

/**
 * Medium confetti for real wins: job live, first order, batch shipped, season end, money milestones.
 * Fire once per event. Reduced motion skips the confetti and the pop.
 */
export function Celebration({ icon, title, body, action, burst = 0, className }: CelebrationProps) {
  const boxRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `burst` is the re-fire signal.
  useEffect(() => {
    const box = boxRef.current;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!box || !canvas || !ctx || prefersReducedMotion()) return;

    const styles = getComputedStyle(box);
    const colours = PALETTE_VARS.map((v) => styles.getPropertyValue(v).trim()).filter(Boolean);
    const w = box.offsetWidth;
    const h = box.offsetHeight;
    canvas.width = w;
    canvas.height = h;
    const pieces = Array.from({ length: PIECES }, (_, i) => ({
      x: w / 2,
      y: h * 0.35,
      vx: (Math.random() - 0.5) * 9,
      vy: -Math.random() * 8 - 3,
      size: Math.random() * 6 + 4,
      spin: Math.random() * 6,
      colour: colours[i % colours.length] ?? "currentColor",
    }));
    const start = performance.now();
    let frame = 0;
    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, w, h);
      ctx.globalAlpha = Math.max(0, 1 - Math.max(0, t - 1000) / 600);
      for (const p of pieces) {
        p.vy += 0.25;
        p.x += p.vx;
        p.y += p.vy;
        p.spin += 0.1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.fillStyle = p.colour;
        ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        ctx.restore();
      }
      if (t < CONFETTI_MS) frame = requestAnimationFrame(draw);
      else ctx.clearRect(0, 0, w, h);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [burst]);

  return (
    <div
      key={burst}
      ref={boxRef}
      role="status"
      className={cn(
        "relative max-w-95 overflow-hidden rounded-lg bg-surface px-6 py-8 text-center shadow-lg",
        "motion-safe:animate-[daybell-pop_420ms_var(--ease-bounce)]",
        className,
      )}
    >
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0" aria-hidden="true" />
      {icon ? (
        <div
          className="mx-auto mb-3 grid size-14 place-items-center rounded-full bg-lime text-2xl"
          aria-hidden="true"
        >
          {icon}
        </div>
      ) : null}
      <p className="m-0 text-h2">{title}</p>
      {body ? <p className="mt-1.5 mb-6 text-muted">{body}</p> : null}
      {action}
    </div>
  );
}
