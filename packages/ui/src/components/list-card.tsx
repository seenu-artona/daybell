import { Children, type HTMLAttributes, type ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ListCardProps extends HTMLAttributes<HTMLElement> {
  /** Names the card as a region, when the page has more than one list. */
  label?: string;
  /** The toolbar's left side, over the list (D147): the filter chips. */
  toolbar?: ReactNode;
  /** The toolbar's right end: the search. */
  toolbarEnd?: ReactNode;
  /** Under the list: counts, "Show more", or a note such as "Prices before tax" (14px, muted). */
  footer?: ReactNode;
}

/**
 * The white card a D144 list sits in: 20px corners and a soft shadow on the canvas, no border. With a toolbar (D147),
 * its first row holds the list's filter chips on the left and its search on the right, with a hairline under it.
 */
export function ListCard({
  label,
  toolbar,
  toolbarEnd,
  footer,
  className,
  children,
  ...props
}: ListCardProps) {
  // A card that is only a toolbar (a section's chips over content in cards of its own) has no hairline at its foot.
  const below = Children.toArray(children).length > 0 || Boolean(footer);
  return (
    <section
      aria-label={label}
      className={cn("overflow-hidden rounded-list bg-surface shadow-card", className)}
      {...props}
    >
      {toolbar || toolbarEnd ? (
        <div
          data-list-toolbar=""
          className={cn(
            "flex min-h-17 items-center gap-3 px-3.5 py-3",
            below && "border-b border-line",
          )}
        >
          <div className="min-w-0 flex-1">{toolbar}</div>
          {toolbarEnd ? <div className="flex shrink-0 items-center gap-2">{toolbarEnd}</div> : null}
        </div>
      ) : null}
      {children}
      {footer ? (
        <div className="flex min-h-14 flex-wrap items-center gap-3 border-t border-line px-6 py-2 text-body text-muted">
          {footer}
        </div>
      ) : null}
    </section>
  );
}
