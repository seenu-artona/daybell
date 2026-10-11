import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = cva(
  "inline-grid shrink-0 place-items-center text-ink [&_svg]:size-4.5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        primary: "bg-primary-soft",
        lime: "bg-lime-soft",
        info: "bg-info-soft",
        warning: "bg-warning-soft",
        danger: "bg-danger-soft",
        neutral: "bg-subtle",
      },
      /** "square" is a list row's 38px icon tile; "round" a 34px initials avatar. */
      shape: {
        square: "size-9.5 rounded-md",
        round: "size-8.5 rounded-full text-caption font-extrabold",
      },
    },
    defaultVariants: { tone: "neutral", shape: "square" },
  },
);

export const ICON_CHIP_TONES = ["primary", "lime", "info", "warning", "danger", "neutral"] as const;
export type IconChipTone = (typeof ICON_CHIP_TONES)[number];

export interface IconChipProps
  extends Omit<HTMLAttributes<HTMLSpanElement>, "aria-hidden">,
    VariantProps<typeof variants> {}

/**
 * A pastel icon tile at the start of a list row, or an initials avatar (D140). Always decorative and hidden from
 * screen readers: the row's own words carry the meaning, never the chip's colour (D91).
 */
export function IconChip({ tone, shape, className, ...props }: IconChipProps) {
  return (
    <span aria-hidden="true" className={cn(variants({ tone, shape }), className)} {...props} />
  );
}
