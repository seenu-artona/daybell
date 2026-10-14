import { Slot } from "@radix-ui/react-slot";
import type { AnchorHTMLAttributes, HTMLAttributes, ReactNode } from "react";
import { cn } from "../lib/cn";

export interface ViewBarProps extends HTMLAttributes<HTMLDivElement> {
  /**
   * "main" (default) is a page's first row (D145, amends D144): pill MainTabs on the left, no line under it.
   * "sub" is a second level under pill tabs (a job's Subjects, Photos, Orders): dash ViewTabs over a hairline.
   */
  variant?: "main" | "sub";
  /** The left side: MainTabs on a "main" bar, ViewTabs on a "sub" bar. */
  tabs?: ReactNode;
  /** The right end, in D145 order (amends D144): the filter icon, search, quiet actions, then the one green action. */
  actions?: ReactNode;
}

/**
 * One row over a list (D144): its views on the left, its tools on the right end. Only a second-level ("sub") bar has
 * a hairline under it, for its dashes to sit on.
 */
export function ViewBar({ variant = "main", tabs, actions, className, ...props }: ViewBarProps) {
  return (
    <div
      className={cn(
        "flex min-h-14 items-center gap-6",
        variant === "sub" && "border-b border-line-canvas",
        className,
      )}
      {...props}
    >
      <div className="min-w-0 flex-1">{tabs}</div>
      {actions ? <div className="flex shrink-0 items-center gap-2 py-1.5">{actions}</div> : null}
    </div>
  );
}

export interface ViewTabsProps extends HTMLAttributes<HTMLElement> {
  /** The navigation landmark's name, e.g. "Order views". */
  label: string;
}

/**
 * A list's views as a second level under pill tabs (D145, amends D144: a page's first row of tabs is MainTabs):
 * links that change the address (?status=…), so a navigation with aria-current, not an ARIA tablist. Scrolls
 * sideways when the row is full at 1280px (D136).
 */
export function ViewTabs({ label, className, children, ...props }: ViewTabsProps) {
  return (
    <nav aria-label={label} className={cn("min-w-0", className)} {...props}>
      <ul className="m-0 flex list-none gap-7 overflow-x-auto p-0">{children}</ul>
    </nav>
  );
}

export interface ViewTabProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  current?: boolean;
  /** Render the child element (for example a Next.js Link) with the view's styles. */
  asChild?: boolean;
}

/**
 * One view, 56px tall. The current one is ink and bold with a 4px ink dash on the line (decorative: bold and
 * aria-current say it too, D91).
 */
export function ViewTab({ current, asChild = false, className, children, ...props }: ViewTabProps) {
  const Comp = asChild ? Slot : "a";
  return (
    <li className="relative shrink-0">
      <Comp
        aria-current={current ? "page" : undefined}
        className={cn(
          "flex h-14 items-center whitespace-nowrap rounded-sm text-body-lg no-underline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          current ? "font-bold text-ink" : "font-semibold text-muted hover:text-ink",
          className,
        )}
        {...props}
      >
        {children}
      </Comp>
      {current ? (
        <span
          aria-hidden="true"
          data-view-dash=""
          className="pointer-events-none absolute inset-x-0 bottom-0 h-1 rounded-full bg-ink"
        />
      ) : null}
    </li>
  );
}
