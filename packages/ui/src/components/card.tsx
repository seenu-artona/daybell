import { Slot } from "@radix-ui/react-slot";
import type { HTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * "default" is the bordered card. "sheet" is a white card with 20px corners, a soft shadow and no border, on the
   * canvas (D140, D144); its content is usually hairline rows (CardRow).
   */
  variant?: "default" | "sheet";
  /** Render the child element (for example a section) with the card's styles. */
  asChild?: boolean;
}

export function Card({ className, variant = "default", asChild = false, ...props }: CardProps) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      className={cn(
        variant === "sheet"
          ? "rounded-list bg-surface px-6 py-1.5 shadow-card"
          : "rounded-lg border border-line bg-surface p-4 shadow-sm sm:p-6",
        className,
      )}
      {...props}
    />
  );
}

/** One hairline row in a sheet card: at least 56px, a thin line under every row but the last (D140). */
export function CardRow({
  className,
  asChild = false,
  ...props
}: HTMLAttributes<HTMLDivElement> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "div";
  return (
    <Comp
      className={cn(
        "flex min-h-14 items-center gap-3.5 border-b border-line last:border-b-0",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({ className, ...props }: HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("m-0 mb-1 text-h3", className)} {...props} />;
}

export function CardMeta({ className, ...props }: HTMLAttributes<HTMLParagraphElement>) {
  return <p className={cn("m-0 text-body text-muted", className)} {...props} />;
}
