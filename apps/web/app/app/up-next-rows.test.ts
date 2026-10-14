import type { UpNextItem } from "@daybell/api";
import { describe, expect, it } from "vitest";
import { orderTodoHref, UP_NEXT_ROWS, upNextRows } from "./up-next-rows";

const job = (jobId: string, reason: UpNextItem["reason"]): UpNextItem => ({
  jobId,
  jobName: `Job ${jobId}`,
  task: "addRoster",
  reason,
});
const none = { toPrint: 0, toShip: 0, toDeliver: 0 };
const ids = (rows: ReturnType<typeof upNextRows>) =>
  rows.map((r) => (r.kind === "job" ? r.item.jobId : r.todo));

describe("upNextRows (D146)", () => {
  it("puts the orders waiting after broken things and before next steps (D143's money is waiting)", () => {
    const rows = upNextRows(
      [
        job("overdue", { kind: "photosOverdue", days: 3 }),
        job("broken", { kind: "brokenPhotos", count: 2 }),
        job("next", { kind: "nextStep" }),
      ],
      { toPrint: 12, toShip: 3, toDeliver: 0 },
    );
    expect(ids(rows)).toEqual(["overdue", "broken", "toPrint", "toShip", "next"]);
    expect(rows[2]).toEqual({ kind: "orders", todo: "toPrint", count: 12 });
  });

  it("keeps the server's order on ties (nearest date first) and lists order to-dos print, ship, school", () => {
    const rows = upNextRows(
      [job("b", { kind: "dateClose", days: 2 }), job("a", { kind: "dateClose", days: 9 })],
      { toPrint: 0, toShip: 0, toDeliver: 0 },
    );
    expect(ids(rows)).toEqual(["b", "a"]);
    expect(ids(upNextRows([], { toPrint: 1, toShip: 1, toDeliver: 1 }))).toEqual([
      "toPrint",
      "toShip",
      "toDeliver",
    ]);
  });

  it("shows at most five rows, dropping the least urgent", () => {
    const rows = upNextRows(
      [
        job("a", { kind: "nextStep" }),
        job("b", { kind: "nextStep" }),
        job("c", { kind: "nextStep" }),
      ],
      { toPrint: 1, toShip: 1, toDeliver: 1 },
    );
    expect(rows).toHaveLength(UP_NEXT_ROWS);
    expect(ids(rows)).toEqual(["toPrint", "toShip", "toDeliver", "a", "b"]);
  });

  it("leaves out empty order to-dos, and works without them (people who don't see orders)", () => {
    expect(upNextRows([], none)).toEqual([]);
    expect(ids(upNextRows([job("a", { kind: "nextStep" })], null))).toEqual(["a"]);
  });

  it("links each order to-do to the orders it counts", () => {
    expect(orderTodoHref("toPrint")).toBe("/app/orders?status=paid");
    expect(orderTodoHref("toShip")).toBe("/app/orders?status=printed&delivery=home");
    expect(orderTodoHref("toDeliver")).toBe("/app/orders?status=printed&delivery=school");
  });
});
