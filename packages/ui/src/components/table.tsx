"use client";

import { ChevronRight } from "lucide-react";
import type { HTMLAttributes, MouseEvent, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /**
   * "boxed" (default) sits in a bordered, rounded box. "flat" is one flat list on white with no box around it, for the
   * main area of a D137 page (e.g. a job's People). "list" is the D144 list inside a ListCard: no box, 16px body text,
   * 14px headers, 24px at both ends of every row.
   */
  variant?: "boxed" | "flat" | "list";
}

const LIST =
  "text-body-lg [&_th]:text-body [&_td:first-child]:pl-6 [&_td:last-child]:pr-6 [&_th:first-child]:pl-6 [&_th:last-child]:pr-6";

/**
 * Scrolls sideways instead of squashing columns. The wrapper is `relative` so absolutely positioned content inside
 * (e.g. `sr-only` header text) is clipped by it too; otherwise that text escapes the scroll box and widens the whole
 * page (D72).
 */
export function Table({ className, variant = "boxed", ...props }: TableProps) {
  return (
    <div
      className={cn(
        "relative overflow-x-auto bg-surface",
        variant === "boxed" && "rounded-lg border border-line",
      )}
    >
      <table
        className={cn("w-full border-collapse text-sm", variant === "list" && LIST, className)}
        {...props}
      />
    </div>
  );
}

export function TableRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return (
    <tr
      className={cn("border-b border-line last:border-b-0 [tbody_&]:hover:bg-subtle", className)}
      {...props}
    />
  );
}

/** Clicks that start on these are theirs, not the row's. */
const OWN_CLICKS = "a, button, input, label, select, textarea, summary, [role='button']";

export interface ClickableRowProps extends HTMLAttributes<HTMLTableRowElement> {
  /** A click anywhere else on the row: open what the row's main link or button opens. */
  onActivate: () => void;
}

/**
 * A list row that opens its item on a click anywhere (D144). The row's main link or button stays the keyboard and
 * screen-reader target (the row itself is not focusable); give it `group-hover:underline` so the hover shows where
 * the click goes. Clicks that start on a link, button or form control, or that end a text selection, are ignored.
 * Nothing extra appears on hover; the background turns canvas grey.
 */
export function ClickableRow({ onActivate, onClick, className, ...props }: ClickableRowProps) {
  function click(event: MouseEvent<HTMLTableRowElement>) {
    onClick?.(event);
    if (event.defaultPrevented) return;
    const target = event.target as Element | null;
    if (target?.closest(OWN_CLICKS)) return;
    if (typeof window !== "undefined" && (window.getSelection()?.toString() ?? "") !== "") return;
    onActivate();
  }
  return (
    <TableRow
      className={cn("group cursor-pointer [tbody_&]:hover:bg-canvas", className)}
      onClick={click}
      {...props}
    />
  );
}

/** The faint chevron at the end of a clickable row; decorative (the row's link carries the name). */
export function RowChevron({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td
      aria-hidden="true"
      className={cn("w-12 px-4 py-3 text-right text-line-strong group-hover:text-ink", className)}
      {...props}
    >
      <ChevronRight className="inline-block size-5" />
    </td>
  );
}

/** The header row's cell over the chevrons: empty and hidden, so the columns line up. */
export function RowChevronHead({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td aria-hidden="true" className={cn("w-12 border-b border-line", className)} {...props} />
  );
}

interface CellExtra {
  /** Right-aligned with tabular numbers, for money and counts. */
  numeric?: boolean;
}

export function TableHead({
  className,
  numeric,
  ...props
}: ThHTMLAttributes<HTMLTableCellElement> & CellExtra) {
  return (
    <th
      scope="col"
      className={cn(
        "whitespace-nowrap border-b border-line px-4 py-3 text-left text-caption font-semibold text-muted",
        numeric && "text-right",
        className,
      )}
      {...props}
    />
  );
}

export function TableCell({
  className,
  numeric,
  ...props
}: TdHTMLAttributes<HTMLTableCellElement> & CellExtra) {
  return (
    <td className={cn("px-4 py-3", numeric && "text-right tabular-nums", className)} {...props} />
  );
}
