import { ViewBar } from "@daybell/ui";
import type { ReactNode } from "react";

/**
 * One job section in the D144 layout, under the job's tabs: a heading for screen readers (h2, visually hidden), one
 * view bar (the section's views on the left, its tools on the right, e.g. quiet menus, search and one green action),
 * then the content in white cards. A FloatingPanel passed as `panel` floats over the right side of the content, 400px
 * wide.
 */
export function JobSection({
  title,
  views,
  tools,
  below,
  panel,
  children,
}: {
  /** The section's heading (h2), read by screen readers, e.g. "6 children". */
  title?: ReactNode;
  /** The view bar's left side: ViewTabs. */
  views?: ReactNode;
  /** The view bar's right end, in D144 order. */
  tools?: ReactNode;
  /** Under the view bar, above the content: notices and selection bars. */
  below?: ReactNode;
  panel?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col gap-4">
      {title ? <h2 className="sr-only">{title}</h2> : null}
      {views || tools ? <ViewBar tabs={views} actions={tools} /> : null}
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
