import { describe, expect, it } from "vitest";
import { orderTodoHref } from "../up-next-rows";
import {
  BUILT_IN_ORDER_CHIPS,
  orderChipFrom,
  orderChipFromSaved,
  orderChipHref,
  orderChipQuery,
} from "./order-view";

const JOB = "a0000000-0000-4000-8000-000000000001";
const from = (query: string, withJob = true) =>
  orderChipFrom(new URLSearchParams(query), { withJob });

describe("Orders chips (D147)", () => {
  it("built in: All, To print, To ship, To take to school, Done", () => {
    expect(BUILT_IN_ORDER_CHIPS.map((c) => orderChipHref("/app/orders", c))).toEqual([
      "/app/orders",
      "/app/orders?status=paid",
      "/app/orders?status=printed&delivery=home",
      "/app/orders?status=printed&delivery=school",
      "/app/orders?status=done",
    ]);
  });

  it("Home's Up next links still open their chip", () => {
    const chipOf = (href: string) => from(new URL(href, "http://x").search.slice(1));
    expect(chipOf(orderTodoHref("toPrint"))).toEqual({ chip: { kind: "toPrint" }, clean: false });
    expect(chipOf(orderTodoHref("toShip"))).toEqual({ chip: { kind: "toShip" }, clean: false });
    expect(chipOf(orderTodoHref("toDeliver"))).toEqual({
      chip: { kind: "toSchool" },
      clean: false,
    });
  });

  it("reads each chip from the address and round-trips it, in either parameter order", () => {
    for (const query of ["status=done", "delivery=home", "delivery=school", `job=${JOB}`]) {
      const { chip, clean } = from(query);
      expect(clean).toBe(false);
      expect(orderChipHref("/app/orders", chip)).toBe(`/app/orders?${query}`);
    }
    expect(from("delivery=home&status=printed").chip).toEqual({ kind: "toShip" });
  });

  it("other combinations are All and clean the address; a job's tab takes no job chip", () => {
    for (const query of [
      "status=printed",
      "status=shipped",
      "status=paid&delivery=home",
      "job=Lincoln",
      `job=${JOB}&status=paid`,
    ])
      expect(from(query)).toEqual({ chip: { kind: "all" }, clean: true });
    expect(from(`job=${JOB}`, false)).toEqual({ chip: { kind: "all" }, clean: true });
    expect(from("")).toEqual({ chip: { kind: "all" }, clean: false });
  });

  it("asks the API for the chip's statuses, delivery or job", () => {
    expect(orderChipQuery({ kind: "all" })).toEqual({});
    expect(orderChipQuery({ kind: "toShip" })).toEqual({ status: "printed", delivery: "home" });
    expect(orderChipQuery({ kind: "done" })).toEqual({ stage: "done" });
    expect(orderChipQuery({ kind: "deliverySchool" })).toEqual({ delivery: "school" });
    expect(orderChipQuery({ kind: "job", id: JOB })).toEqual({ jobId: JOB });
  });

  it("saved chips become filters; a job's tab drops job chips", () => {
    expect(orderChipFromSaved({ key: "deliveryHome", value: null })).toEqual({
      kind: "deliveryHome",
    });
    expect(orderChipFromSaved({ key: "job", value: JOB })).toEqual({ kind: "job", id: JOB });
    expect(orderChipFromSaved({ key: "job", value: JOB }, false)).toBeNull();
    expect(orderChipFromSaved({ key: "client", value: JOB })).toBeNull();
  });
});
