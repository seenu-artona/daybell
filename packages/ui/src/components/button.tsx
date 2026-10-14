import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "../lib/cn";

const variants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md border border-transparent font-semibold transition-[background-color,border-color,transform] duration-[var(--duration-fast)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary active:translate-y-px disabled:pointer-events-none disabled:opacity-45 [&_svg]:size-4 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary-hover",
        secondary: "border-line-strong bg-surface text-ink hover:bg-subtle",
        ghost: "bg-transparent text-primary hover:bg-primary-soft",
        danger: "bg-danger text-on-primary hover:brightness-95",
        /** A white pill action on the canvas, no border (D140). Use with shape="pill". */
        white: "bg-surface text-ink hover:bg-subtle",
        /** A quiet text action in a view bar or a list row (D144): no fill until hovered. */
        quiet: "bg-transparent text-ink hover:bg-surface",
      },
      size: {
        md: "min-h-11 px-[18px] text-sm",
        sm: "min-h-8 rounded-sm px-3 text-label",
      },
      /** "pill" is fully round (D140): the job header's Start selling and the toolbars' white actions. */
      shape: {
        default: "",
        pill: "rounded-full px-5",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "primary", size: "md", shape: "default", block: false },
  },
);

/** The button classes, with later ones winning (e.g. a pill's rounding over the size's). */
export function buttonVariants(props?: VariantProps<typeof variants>): string {
  return cn(variants(props));
}

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof variants> {
  /** Render the child element (for example a link) with button styles. */
  asChild?: boolean;
}

export function Button({
  className,
  variant,
  size,
  shape,
  block,
  asChild = false,
  type,
  ...props
}: ButtonProps) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={cn(variants({ variant, size, shape, block }), className)}
      {...(asChild ? {} : { type: type ?? "button" })}
      {...props}
    />
  );
}
