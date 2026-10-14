import type { HTMLAttributes, ReactNode, Ref } from "react";
import { cn } from "../lib/cn";

export interface PageHeaderProps extends Omit<HTMLAttributes<HTMLElement>, "title"> {
  /** "list": a list page's title alone (h1, 32px). "record": one record's header, e.g. a job (D144). */
  variant?: "list" | "record";
  /** The page's h1. */
  title: ReactNode;
  /** Record only: before the title, a 44px round back button (e.g. an IconButton link). */
  back?: ReactNode;
  /** Record only: beside the title, e.g. a status pill. */
  status?: ReactNode;
  /** Record only: the right end, e.g. a white pill and a round More button. */
  actions?: ReactNode;
  /** Record only: one muted line under the title. */
  details?: ReactNode;
  /** For moving focus to the title (it gets tabIndex -1 when set). */
  headingRef?: Ref<HTMLHeadingElement>;
}

/**
 * A page's title row on the canvas (D144). A list page shows only its h1; a record (a job) has a back button, its name
 * at 28px with a status beside it, an optional details line, and its actions on the right. Anything passed as
 * children goes under the details line (e.g. a live status message).
 */
export function PageHeader({
  variant = "list",
  title,
  back,
  status,
  actions,
  details,
  headingRef,
  className,
  children,
  ...props
}: PageHeaderProps) {
  const focusable = headingRef
    ? { ref: headingRef, tabIndex: -1 }
    : ({} as { ref?: undefined; tabIndex?: undefined });
  if (variant === "list") {
    return (
      <header className={cn("flex flex-col gap-1", className)} {...props}>
        <h1
          {...focusable}
          className="m-0 text-h1 text-ink focus-visible:outline-2 focus-visible:outline-primary"
        >
          {title}
        </h1>
        {children}
      </header>
    );
  }
  return (
    <header className={cn("flex items-center gap-4", className)} {...props}>
      {back}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <h1
            {...focusable}
            className="m-0 text-job-title break-words text-ink focus-visible:outline-2 focus-visible:outline-primary"
          >
            {title}
          </h1>
          {status}
        </div>
        {details ? <p className="m-0 text-body text-muted">{details}</p> : null}
        {children}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  );
}
