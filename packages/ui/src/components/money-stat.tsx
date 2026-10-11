"use client";

import { type Currency, formatMoney, money } from "@daybell/core";
import { type ReactNode, useEffect, useState } from "react";
import { cn } from "../lib/cn";
import { prefersReducedMotion } from "../lib/motion";

export interface MoneyStatProps {
  label: ReactNode;
  cents: number;
  currency: Currency;
  locale?: "en-US" | "en-CA";
  /** Small lime pill under the figure, e.g. "▲ $3,140 this week". */
  delta?: ReactNode;
  /** Count up from zero on first show. Skipped with reduced motion. */
  animate?: boolean;
  className?: string;
}

/** The "I'm making money" card. One per screen. */
export function MoneyStat({
  label,
  cents,
  currency,
  locale = "en-US",
  delta,
  animate = true,
  className,
}: MoneyStatProps) {
  const [shown, setShown] = useState(cents);

  useEffect(() => {
    if (!animate || prefersReducedMotion()) {
      setShown(cents);
      return;
    }
    let frame = 0;
    const start = performance.now();
    const duration = 900;
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setShown(Math.round((cents * eased) / 100) * 100);
      if (p < 1) frame = requestAnimationFrame(tick);
      else setShown(cents);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [cents, animate]);

  const final = formatMoney(money(cents, currency), locale, { whole: true });
  return (
    <div className={cn("rounded-lg border border-lime bg-lime-soft p-6", className)}>
      <p className="m-0 text-label text-muted">{label}</p>
      {/* Screen readers get the final figure once, not every animation frame. */}
      <p className="my-1.5 text-money-xl tracking-tight tabular-nums">
        <span aria-hidden="true">
          {formatMoney(money(shown, currency), locale, { whole: true })}
        </span>
        <span className="sr-only">{final}</span>
      </p>
      {delta ? (
        <span className="inline-flex items-center gap-1 rounded-full bg-lime px-2.5 text-xs leading-[18px] font-bold">
          {delta}
        </span>
      ) : null}
    </div>
  );
}

export interface StatProps {
  label: ReactNode;
  value: ReactNode;
  className?: string;
}

/** A plain supporting number next to the MoneyStat. */
export function Stat({ label, value, className }: StatProps) {
  return (
    <div className={cn("rounded-lg border border-line bg-surface px-6 py-4", className)}>
      <p className="m-0 text-label text-muted">{label}</p>
      <p className="mt-1 mb-0 text-stat tabular-nums">{value}</p>
    </div>
  );
}
