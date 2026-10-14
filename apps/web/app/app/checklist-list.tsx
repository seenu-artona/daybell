"use client";

import type { TaskState } from "@daybell/core";
import { cn } from "@daybell/ui";
import { Check, ChevronRight } from "lucide-react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";

export interface ChecklistRow {
  key: string;
  label: string;
  state: TaskState;
  /** The page where the work happens, or null: no page, or the person's role can't do it (shown as plain text). */
  href: string | null;
  /** A short fact beside the task, e.g. "3 children". */
  note?: string | null;
}

export interface ChecklistRowGroup {
  key: string;
  /** Milestone name; omitted for a flat list (Home's studio setup). */
  title?: string;
  /** The group the job is in now: says "Now" in words. */
  current?: boolean;
  rows: ChecklistRow[];
}

/** Done: a filled green circle with a check. Next: a green ring. To do: a grey ring. Decorative: the row says it. */
function CheckCircle({ state }: { state: TaskState }) {
  return (
    <span
      aria-hidden="true"
      className={`grid size-5.5 shrink-0 place-items-center rounded-full ${
        state === "done"
          ? "bg-primary text-on-primary"
          : state === "next"
            ? "ring-2 ring-primary ring-inset"
            : "ring-2 ring-line-strong ring-inset"
      }`}
    >
      {state === "done" ? <Check className="size-3.5" strokeWidth={3} /> : null}
    </span>
  );
}

/**
 * "plain": rows inside a padded card (the job's Overview). "rows": full-width list-card rows in the ClickableRow style
 * (Home; D145, amends D144): 16px text, 56px rows, canvas grey on hover with the task underlined and a faint
 * chevron that darkens.
 */
export type ChecklistLook = "plain" | "rows";

const ROW = {
  plain:
    "flex min-h-11 w-full items-center gap-3 py-2 text-body no-underline text-ink focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
  rows: "group flex min-h-14 w-full items-center gap-3 px-6 py-2 text-body-lg no-underline text-ink focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-primary",
} as const;

/** One task. The whole row is one link (44px or more) when there is somewhere to go; never a button (D143). */
function Row({ row, look }: { row: ChecklistRow; look: ChecklistLook }) {
  const t = useTranslations("app.checklist");
  const content: ReactNode = (
    <>
      <CheckCircle state={row.state} />
      <span
        className={cn(
          "min-w-0 flex-1",
          row.state === "done"
            ? "text-muted line-through decoration-line-strong"
            : row.state === "next"
              ? "font-bold"
              : "",
          look === "rows" && row.href && "group-hover:underline",
        )}
      >
        {row.label}
      </span>
      {row.note ? <span className="text-caption text-muted">{row.note}</span> : null}
      {/* The state in words (D91): "Next" is shown; "Done" and "To do" are read out (the circle shows them). */}
      {row.state === "next" ? (
        <span className="rounded-full bg-primary-soft px-2 text-micro text-primary-hover">
          {t("next")}
        </span>
      ) : (
        <span className="sr-only">{row.state === "done" ? t("done") : t("todo")}</span>
      )}
      {look === "rows" && row.href ? (
        <ChevronRight
          aria-hidden="true"
          className="size-5 shrink-0 text-line-strong group-hover:text-ink"
        />
      ) : null}
    </>
  );
  return (
    <li className={cn("border-t border-line", look === "plain" && "first:border-t-0")}>
      {row.href ? (
        <Link
          href={row.href}
          className={cn(ROW[look], look === "rows" ? "hover:bg-canvas" : "hover:bg-subtle")}
        >
          {content}
        </Link>
      ) : (
        <div className={ROW[look]}>{content}</div>
      )}
    </li>
  );
}

/** "N of M done" in words, with a bar that only repeats it (hidden from screen readers). */
export function ChecklistProgress({ done, total }: { done: number; total: number }) {
  const t = useTranslations("app.checklist");
  const percent = total === 0 ? 0 : Math.round((done / total) * 100);
  return (
    <div className="flex flex-col gap-2">
      <p className="m-0 text-label text-muted">{t("progress", { done, total })}</p>
      <div aria-hidden="true" className="h-1.5 overflow-hidden rounded-full bg-line">
        <div className="h-full rounded-full bg-primary" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

/**
 * The checklist's rows (D143; ADR 0017), shared by the job Overview and Home's studio setup: one list per milestone
 * with its name as a heading, or one flat list.
 */
export function ChecklistGroups({
  groups,
  headingLevel = 3,
  look = "plain",
}: {
  groups: ChecklistRowGroup[];
  headingLevel?: 3 | 4;
  look?: ChecklistLook;
}) {
  const t = useTranslations("app.checklist");
  const Heading = headingLevel === 3 ? "h3" : "h4";
  return (
    <div className="flex flex-col">
      {groups.map((group) => (
        <div key={group.key} className="flex flex-col">
          {group.title ? (
            <Heading
              className={cn(
                "m-0 flex items-center gap-2 pt-3 pb-1 text-micro tracking-wide text-muted uppercase",
                look === "rows" && "px-6",
              )}
            >
              {group.title}
              {group.current ? (
                <span className="rounded-full bg-subtle px-2 text-ink normal-case">{t("now")}</span>
              ) : null}
            </Heading>
          ) : null}
          <ul className="m-0 list-none p-0">
            {group.rows.map((row) => (
              <Row key={row.key} row={row} look={look} />
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
