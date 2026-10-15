import type { SVGAttributes } from "react";
import { cn } from "../lib/cn";

/** The two arcs of the Ridge mark, drawn on a 64 × 64 box (the same paths as the favicon). */
export const RIDGE_TOP_ARC = "M6 44 Q32 8 58 44";
export const RIDGE_BOTTOM_ARC = "M14 50 Q32 24 50 50";

const TONES = {
  /** On light backgrounds: primary green over ink. */
  light: { top: "stroke-primary", bottom: "stroke-ink" },
  /** On dark backgrounds (the ink side menu): lime over white. */
  // The white arc uses on-primary because it is the design system's white token (#FFFFFF); there is no "white".
  dark: { top: "stroke-lime", bottom: "stroke-on-primary" },
} as const;

export interface RidgeMarkProps
  extends Omit<SVGAttributes<SVGSVGElement>, "role" | "aria-label" | "aria-hidden"> {
  /** "light" for light backgrounds, "dark" for dark ones. */
  tone?: keyof typeof TONES;
  /**
   * The accessible name, from the locale files (e.g. "Silverback"). Leave it out when the word sits beside the mark:
   * the mark is then decorative and hidden from screen readers (D91).
   */
  label?: string;
}

/**
 * Silverback's interim "Ridge" mark (D155; ADR 0031): two arcs in the brand's design tokens, never raw hex (D112).
 * A designer will replace it with the final mark.
 */
export function RidgeMark({ tone = "light", label, className, ...props }: RidgeMarkProps) {
  const colours = TONES[tone];
  const a11y = label ? { role: "img", "aria-label": label } : { "aria-hidden": true as const };
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 64 64"
      fill="none"
      strokeWidth={7}
      strokeLinecap="round"
      focusable="false"
      className={cn("size-8 shrink-0", className)}
      {...a11y}
      {...props}
    >
      <path d={RIDGE_TOP_ARC} className={colours.top} />
      <path d={RIDGE_BOTTOM_ARC} className={colours.bottom} />
    </svg>
  );
}
