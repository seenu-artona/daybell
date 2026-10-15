import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface SwitchProps
  extends Omit<
    ButtonHTMLAttributes<HTMLButtonElement>,
    "aria-label" | "onChange" | "role" | "children"
  > {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  /** The accessible name, e.g. "Sold: Package A" (WCAG 4.1.2). Required: the switch shows only its state. */
  label: string;
  /** The state in words, shown beside the track so it never rests on colour alone (D91), from the locale files. */
  onText: string;
  offText: string;
}

/**
 * An on/off switch (D157; D91): a button with role="switch" and aria-checked, a 44px target, a visible focus ring and
 * its state in words beside the track (On/Off). The words are part of the picture only: the state is read out from
 * aria-checked and the name from `label`.
 */
export function Switch({
  checked,
  onCheckedChange,
  label,
  onText,
  offText,
  className,
  type,
  onClick,
  ...props
}: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      type={type ?? "button"}
      onClick={(event) => {
        onClick?.(event);
        if (!event.defaultPrevented) onCheckedChange(!checked);
      }}
      className={cn(
        "inline-flex min-h-11 min-w-11 shrink-0 items-center gap-2 rounded-full px-1 text-sm font-semibold text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45",
        className,
      )}
      {...props}
    >
      <span
        aria-hidden="true"
        className={cn(
          "relative inline-flex h-6 w-10 shrink-0 items-center rounded-full border-2 transition-colors duration-[var(--duration-fast)]",
          checked ? "border-primary bg-primary" : "border-line-strong bg-subtle",
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 size-4 rounded-full transition-[left] duration-[var(--duration-fast)] motion-reduce:transition-none",
            checked ? "left-[18px] bg-on-primary" : "left-0.5 bg-surface ring-1 ring-line-strong",
          )}
        />
      </span>
      <span aria-hidden="true" className={cn("min-w-7 text-left", !checked && "text-muted")}>
        {checked ? onText : offText}
      </span>
    </button>
  );
}
