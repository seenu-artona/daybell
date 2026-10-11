import { cva, type VariantProps } from "class-variance-authority";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export const badgeVariants = cva(
  "inline-flex h-6 items-center gap-1.5 rounded-full px-2.5 text-xs font-semibold before:size-1.5 before:rounded-full before:bg-current before:content-['']",
  {
    variants: {
      tone: {
        draft: "bg-subtle text-muted",
        selling: "bg-primary-soft text-primary-hover",
        money: "bg-lime text-ink",
        warning: "bg-warning-soft text-warning-text",
        danger: "bg-danger-soft text-danger",
      },
    },
    defaultVariants: { tone: "draft" },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Short status label. The word carries the meaning; colour only supports it (D91). */
export function Badge({ className, tone, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
