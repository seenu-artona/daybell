import { cn, ListCard } from "@daybell/ui";
import { ChevronRight } from "lucide-react";
import Link from "next/link";
import { type ReactNode, useId } from "react";

/**
 * One of Home's sections in the D144 look (amended Oct 14): a white list card (20px corners, soft shadow) named by its
 * h2, an optional muted line under the title, rows with hairlines between them, and an optional footer.
 */
export function HomeCard({
  title,
  intro,
  footer,
  className,
  children,
}: {
  title: string;
  intro?: string;
  footer?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <ListCard aria-labelledby={id} footer={footer} className={className}>
      <div className="px-6 pt-5 pb-3">
        <h2 id={id} className="m-0 text-h3 font-bold text-ink">
          {title}
        </h2>
        {intro ? <p className="m-0 text-body text-muted">{intro}</p> : null}
      </div>
      {children}
    </ListCard>
  );
}

/** A message in place of a card's rows ("Checking…", "No orders are waiting."), under the title's hairline. */
export function HomeNote({ children }: { children: ReactNode }) {
  return (
    <p className="m-0 flex items-center gap-3 border-t border-line px-6 py-4 text-body-lg text-muted">
      {children}
    </p>
  );
}

/** The rows' list: hairlines between rows and under the title. */
export function HomeRows({ ordered, children }: { ordered?: boolean; children: ReactNode }) {
  const List = ordered ? "ol" : "ul";
  return <List className="m-0 list-none p-0">{children}</List>;
}

const ROW =
  "flex min-h-14 items-center gap-3 border-t border-line px-6 py-2 text-body-lg text-ink no-underline";

/**
 * A row that opens somewhere, in the ClickableRow style (D144): the whole row is one link (at least 56px), the row turns
 * canvas grey on hover, its name underlines and the faint chevron at the end darkens (decorative: the link carries the
 * name). `name` is the row's main words; `detail` a muted line under them.
 */
export function HomeLinkRow({
  href,
  name,
  detail,
  className,
  children,
}: {
  href: string;
  name: ReactNode;
  detail?: ReactNode;
  className?: string;
  /** Anything between the words and the chevron. */
  children?: ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        className={cn(
          ROW,
          "group hover:bg-canvas focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
          className,
        )}
      >
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="font-semibold group-hover:underline">{name}</span>
          {detail ? <span className="text-body text-muted">{detail}</span> : null}
        </span>
        {children}
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-line-strong group-hover:text-ink"
        />
      </Link>
    </li>
  );
}

/** A row with nowhere to go (the person's role can't do it, or an activity line): the same layout, no hover. */
export function HomeRow({ className, children }: { className?: string; children: ReactNode }) {
  return <li className={cn(ROW, className)}>{children}</li>;
}

/** A card footer's link ("View all jobs"): ink, not green; Home has no green action of its own (D144). */
export const HOME_FOOTER_LINK =
  "inline-flex min-h-11 items-center font-semibold text-ink underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-primary";
