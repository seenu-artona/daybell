import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ListCardProps extends HTMLAttributes<HTMLElement> {
  /** Names the card as a region, when the page has more than one list. */
  label?: string;
  /** Under the list: counts, "Show more", or a note such as "Prices before tax" (14px, muted). */
  footer?: ReactNode;
}

/** The white card a D144 list sits in: 20px corners and a soft shadow on the canvas, no border. */
export function ListCard({ label, footer, className, children, ...props }: ListCardProps) {
  return (
    <section
      aria-label={label}
      className={cn("overflow-hidden rounded-list bg-surface shadow-card", className)}
      {...props}
    >
      {children}
      {footer ? (
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-t border-line px-6 py-2 text-body text-muted">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
