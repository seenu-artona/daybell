import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

export interface TableProps extends HTMLAttributes<HTMLTableElement> {
  /**
   * "boxed" (default) sits in a bordered, rounded box. "flat" is one flat list on white with no box around it, for the
   * main area of a D137 page (e.g. a job's People).
   */
  variant?: "boxed" | "flat";
}

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
      <table className={cn("w-full border-collapse text-sm", className)} {...props} />
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
