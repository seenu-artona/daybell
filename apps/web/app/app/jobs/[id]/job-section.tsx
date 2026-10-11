import type { ReactNode } from "react";

/**
 * One job section in the D137 layout: the 40px section bar across the top (left: search and filters; right: the
 * section's white buttons), then the flat white main area and, when something is selected, the side panel.
 */
export function JobSection({
  bar,
  barEnd,
  below,
  panel,
  children,
}: {
  /** The bar's left side. */
  bar?: ReactNode;
  /** The bar's right side: the section's white (secondary) buttons. */
  barEnd?: ReactNode;
  /** Under the bar, above the list: filter chips and notices. */
  below?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-0 flex-1 flex-col bg-surface">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-line px-6">
        <div className="flex min-w-0 flex-1 items-center gap-2">{bar}</div>
        {barEnd ? <div className="flex shrink-0 items-center gap-2">{barEnd}</div> : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col">
          {below}
          {children}
        </div>
        {panel}
      </div>
    </div>
  );
}
