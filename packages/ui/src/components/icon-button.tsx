import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = cva(
  "inline-flex size-11 shrink-0 items-center justify-center rounded-full text-ink transition-colors duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-5 [&_svg]:shrink-0",
  {
    variants: {
      tone: {
        /** White, on the canvas. */
        surface: "bg-surface hover:bg-subtle",
        /** Canvas grey, on a white card or panel. */
        canvas: "bg-canvas hover:bg-line",
        /** No fill until hovered, in a view bar on the canvas (D144). */
        quiet: "bg-transparent hover:bg-surface",
      },
    },
    defaultVariants: { tone: "surface" },
  },
);

/** The round 44px icon button's classes, for triggers that render their own button (e.g. a popover's). */
export function iconButtonVariants(props?: VariantProps<typeof variants>): string {
  return cn(variants(props));
}

export interface IconButtonProps
  extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "aria-label">,
    VariantProps<typeof variants> {
  /** The accessible name. Required: the button shows only an icon (WCAG 4.1.2). */
  label: string;
  /** Render the child element (for example a link) with these styles; its content is the icon. */
  asChild?: boolean;
}

/**
 * A round 44px icon button (D140, D91): the job header's back and More, toolbar tools, a panel's close. Give it one
 * icon with aria-hidden; the name comes from `label`.
 */
export function IconButton({
  label,
  tone,
  asChild = false,
  className,
  type,
  ...props
}: IconButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      aria-label={label}
      className={cn(variants({ tone }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
