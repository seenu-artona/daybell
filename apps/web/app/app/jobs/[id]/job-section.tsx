import type { ReactNode } from "react";

/**
 * One job section under the job's tabs (D144; D147): a heading for screen readers (h2, visually hidden), notices, then
 * the content in white cards. The section's actions sit at the right end of the tab row (JobTabActions) and its filter
 * chips in its list card's toolbar, so there is no view bar of its own. A FloatingPanel passed as `panel` floats over
 * the right side of the content, 400px wide.
 */
export function JobSection({
  title,
  below,
  panel,
  children,
}: {
  /** The section's heading (h2), read by screen readers, e.g. "6 children". */
  title?: ReactNode;
  /** Above the content: notices and selection bars. */
  below?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title ? <h2 className="sr-only">{title}</h2> : null}
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
