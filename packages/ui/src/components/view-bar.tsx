import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ViewBarProps extends HTMLAttributes<HTMLDivElement> {
  /** The left side: MainTabs. */
  tabs?: ReactNode;
  /** The right end, in D145 order (amends D144): the filter icon, search, quiet actions, then the one green action. */
  actions?: ReactNode;
}

/**
 * One row of pill tabs with tools at its right end and no line under it (D144, D145). Lists' views are filter chips
 * inside their card since D147, which retired the dash ViewTabs and the "sub" bar.
 */
export function ViewBar({ tabs, actions, className, ...props }: ViewBarProps) {
  return (
    <div className={cn("flex min-h-14 items-center gap-6", className)} {...props}>
      <div className="min-w-0 flex-1">{tabs}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2 py-1.5">{actions}</div> : null}
    </div>
  );
}
