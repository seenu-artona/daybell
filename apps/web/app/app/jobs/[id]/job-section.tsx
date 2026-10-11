import type { ReactNode } from "react";

/**
 * One job section in the D140 layout, on the canvas under the job's tabs: an optional heading row (a plain h2 and a
 * green subline on the left, the section's round tools and white pill actions on the right), then the content in
 * white cards. A FloatingPanel passed as `panel` floats over the right side of the content, 400px wide.
 */
export function JobSection({
  title,
  subline,
  toolbar,
  below,
  panel,
  children,
}: {
  /** The section's heading (h2), e.g. "6 children". */
  title?: ReactNode;
  /** A short line beside the heading. */
  subline?: ReactNode;
  /** The heading row's right side: round icon buttons, a search box and white pill actions. */
  toolbar?: ReactNode;
  /** Under the heading row, above the content: filter chips and notices. */
  below?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title || toolbar ? (
        <div className="flex min-h-11 items-center gap-2.5">
          <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3">
            {title ? <h2 className="m-0 text-h2">{title}</h2> : null}
            {subline ? (
              <p className="m-0 flex items-center gap-1 text-sm font-semibold text-primary">
                {subline}
              </p>
            ) : null}
          </div>
          {toolbar ? <div className="flex shrink-0 items-center gap-2">{toolbar}</div> : null}
        </div>
      ) : null}
      {below}
      <div className="relative">
        {children}
        {panel ? (
          // Spans the content's height so the panel can stay in view (sticky) while the table scrolls; only the
          // panel itself takes clicks.
          <div className="pointer-events-none absolute inset-y-0 right-0 w-[400px]">{panel}</div>
        ) : null}
      </div>
    </div>
  );
}
