"use client";

import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { prefersReducedMotion } from "../lib/motion";

export interface JobProgressProps {
  title: ReactNode;
  /** 0–100. Values outside are clamped. */
  percent: number;
  /** Accessible name for the bar, e.g. "Sales goal". */
  label: string;
  badge?: ReactNode;
  metaStart?: ReactNode;
  metaEnd?: ReactNode;
  className?: string;
}

export function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, Math.round(value)));
}

/** A job's sales moving toward its goal. Always paired with plain numbers (D91). */
export function JobProgress({
  title,
  percent,
  label,
  badge,
  metaStart,
  metaEnd,
  className,
}: JobProgressProps) {
  const target = clampPercent(percent);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setWidth(target);
      return;
    }
    const frame = requestAnimationFrame(() => setWidth(target));
    return () => cancelAnimationFrame(frame);
  }, [target]);

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <div className="flex items-baseline justify-between gap-3">
        <span className="font-bold">{title}</span>
        {badge}
      </div>
      <div
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={target}
        className="h-3 overflow-hidden rounded-full bg-subtle"
      >
        <div
          className="h-full rounded-full bg-gradient-to-r from-primary to-lime transition-[width] duration-900 ease-out motion-reduce:transition-none"
          style={{ width: `${width}%` }}
        />
      </div>
      {metaStart || metaEnd ? (
        <div className="flex justify-between gap-3 text-caption text-muted">
          <span>{metaStart}</span>
          <span>{metaEnd}</span>
        </div>
      ) : null}
    </div>
  );
}
