import { cn } from "@daybell/ui";

/**
 * The classes of a price input (ADR 0019, D91). Built with cn (tailwind-merge), as Field is, so an invalid input's
 * danger border and background replace the normal ones instead of depending on CSS order. The error text under the
 * field still says what is wrong; the colour only supports it.
 */
export function moneyInputClass(invalid: boolean): string {
  return cn(
    "min-h-11 w-36 rounded-md border border-line-strong bg-surface px-3 text-sm text-ink tabular-nums",
    "hover:border-muted focus:border-primary focus:shadow-[0_0_0_3px_var(--color-primary-soft)] focus:outline-none",
    invalid && "border-danger bg-danger-soft",
  );
}
