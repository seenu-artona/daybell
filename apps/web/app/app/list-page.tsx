import { PageHeader, ViewBar } from "@daybell/ui";
import type { ReactNode } from "react";

/**
 * A studio list page (D144): full width on the canvas, the title alone, then one view bar (pill views on the left,
 * tools on the right end, no line under it: D145, amends D144) over the list's white card. Settings, an order and a
 * price list keep PageFrame.
 */
export function ListPage({
  title,
  views,
  actions,
  children,
}: {
  title: ReactNode;
  /** MainTabs, when the list has views: a page's first row of tabs is pills. */
  views?: ReactNode;
  /** The view bar's right end, in D144 order. */
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="flex w-full flex-col gap-6 px-10 pt-8 pb-12">
      <PageHeader title={title} />
      {views || actions ? <ViewBar tabs={views} actions={actions} /> : null}
      {children}
    </div>
  );
}
