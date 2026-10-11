import type { HTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { cn } from "../lib/cn";

/**
 * Scrolls sideways on small screens instead of squashing columns. The wrapper is `relative` so absolutely positioned
 * content inside (e.g. `sr-only` header text) is clipped by it too; otherwise that text escapes the scroll box, widens
 * the whole page and phones zoom the layout out (D72).
 */
export function Table({ className, ...props }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative overflow-x-auto rounded-lg border border-line bg-surface">
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
