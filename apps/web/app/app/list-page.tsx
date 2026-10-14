import { PageHeader } from "@daybell/ui";
import type { ReactNode } from "react";

/**
 * A studio list page (D144; D147): full width on the canvas, a title row with the h1 and the page's one green action at
 * its right end, then, for pages with sections of their own (Jobs: List and Calendar), pill tabs under it. The list's
 * filter chips and search are in its white card's toolbar. Settings, an order and a price list keep PageFrame.
 */
export function ListPage({
  title,
  action,
  sections,
  children,
}: {
  title: ReactNode;
  /** The one green action, e.g. New job. */
  action?: ReactNode;
  /** MainTabs for the page's own sections only, never for filters. */
  sections?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-6 px-10 pt-8 pb-12">
      <div className="flex min-h-11 items-center gap-4">
        <PageHeader title={title} className="min-w-0 flex-1" />
        {action ? <div className="flex shrink-0 items-center gap-2">{action}</div> : null}
      </div>
      {sections}
      {children}
    </div>
  );
}
