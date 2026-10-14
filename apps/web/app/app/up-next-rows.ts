import type { SalesResponse, UpNextItem } from "@daybell/api";
import { upNextRank } from "@daybell/core";

/** Home's Up next shows at most this many rows (D146). */
export const UP_NEXT_ROWS = 5;

export const ORDER_TODOS = ["toPrint", "toShip", "toDeliver"] as const;
export type OrderTodo = (typeof ORDER_TODOS)[number];

export type UpNextRow =
  | { kind: "job"; item: UpNextItem }
  | { kind: "orders"; todo: OrderTodo; count: number };

/**
 * Home's one Up next list (D146, amends D143): the jobs' tasks mixed with the orders waiting (to print, to ship, to take
 * to school), which count as D143's "money is waiting". Most urgent first by D143's tiers; the sort is stable, so ties
 * keep the order they came in: the jobs' tasks as the server ranked them (nearest picture day first), then the order
 * to-dos, which have no date, in print, ship, school order. Order to-dos with nothing waiting are left out. At most
 * `UP_NEXT_ROWS` rows.
 */
export function upNextRows(
  items: readonly UpNextItem[],
  todo: SalesResponse["todo"] | null,
): UpNextRow[] {
  const rows: UpNextRow[] = [
    ...items.map((item) => ({ kind: "job" as const, item })),
    ...(todo
      ? ORDER_TODOS.filter((key) => todo[key] > 0).map((key) => ({
          kind: "orders" as const,
          todo: key,
          count: todo[key],
        }))
      : []),
  ];
  const rank = (row: UpNextRow) =>
    upNextRank(row.kind === "job" ? row.item.reason.kind : "moneyWaiting");
  return rows.sort((a, b) => rank(a) - rank(b)).slice(0, UP_NEXT_ROWS);
}

/** Where an order to-do's orders are listed (the links To do had: the Orders page's view and delivery). */
export function orderTodoHref(todo: OrderTodo): string {
  switch (todo) {
    case "toPrint":
      return "/app/orders?status=paid";
    case "toShip":
      return "/app/orders?status=printed&delivery=home";
    case "toDeliver":
      return "/app/orders?status=printed&delivery=school";
  }
}
