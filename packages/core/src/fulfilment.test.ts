import { describe, expect, it } from "vitest";
import {
  CARRIERS,
  canFulfil,
  canParentCancel,
  canRefund,
  canSeeOrders,
  canSeeSales,
  canUndoStatus,
  fulfilmentNext,
  fulfilmentPrevious,
  fulfilmentSteps,
  normalizeTrackingNumber,
  ORDER_FULFILMENTS,
  trackingLink,
} from "./fulfilment";

const roles = ["owner", "admin", "photographer", "staff", ""];

describe("who does what with orders (answers 3, 4; Q4)", () => {
  it("lets owners, admins and staff see and fulfil orders, never photographers", () => {
    expect(roles.map(canSeeOrders)).toEqual([true, true, false, true, false]);
    expect(roles.map(canFulfil)).toEqual([true, true, false, true, false]);
  });

  it("lets owners and admins refund, undo and see the money", () => {
    for (const can of [canRefund, canUndoStatus, canSeeSales])
      expect(roles.map(can)).toEqual([true, true, false, false, false]);
  });
});

describe("the fulfilment steps", () => {
  it("goes Paid → Printed → Shipped (home) or Delivered (school)", () => {
    expect(fulfilmentNext("paid", "home")).toBe("printed");
    expect(fulfilmentNext("printed", "home")).toBe("shipped");
    expect(fulfilmentNext("printed", "school")).toBe("delivered");
    for (const done of ["shipped", "delivered", "complete", "canceled"] as const)
      expect(fulfilmentNext(done, "home")).toBeNull();
    expect(fulfilmentNext("printed", null)).toBeNull();
  });

  it("goes back one step only", () => {
    expect(fulfilmentPrevious("printed")).toBe("paid");
    expect(fulfilmentPrevious("shipped")).toBe("printed");
    expect(fulfilmentPrevious("delivered")).toBe("printed");
    for (const s of ["paid", "complete", "canceled"] as const)
      expect(fulfilmentPrevious(s)).toBeNull();
  });

  it("shows the steps for the delivery", () => {
    expect(fulfilmentSteps("home")).toEqual(["paid", "printed", "shipped"]);
    expect(fulfilmentSteps("school")).toEqual(["paid", "printed", "delivered"]);
    expect(fulfilmentSteps(null)).toEqual(["complete"]);
    expect(ORDER_FULFILMENTS).toEqual([
      "paid",
      "printed",
      "shipped",
      "delivered",
      "complete",
      "canceled",
    ]);
  });
});

describe("tracking", () => {
  const templates = {
    canada_post: "https://cp.example/track?n={number}",
    purolator: "https://pur.example/{number}",
    ups: "https://ups.example/t?n={number}",
    fedex: "https://fedex.example/t?n={number}",
  };

  it("keeps a tidy number: upper case, single spaces, 4 to 40 characters", () => {
    expect(normalizeTrackingNumber("  1z999aa1  0123 ")).toBe("1Z999AA1 0123");
    expect(normalizeTrackingNumber("abc")).toBeNull();
    expect(normalizeTrackingNumber("ABCD<script>")).toBeNull();
    expect(normalizeTrackingNumber("A".repeat(41))).toBeNull();
  });

  it("links to the carrier's page with the number, or the studio's link for other", () => {
    expect(trackingLink(templates, { carrier: "ups", number: "1Z 999", url: null })).toBe(
      "https://ups.example/t?n=1Z999",
    );
    expect(
      trackingLink(templates, { carrier: "other", number: "X1", url: "https://t.example/X1" }),
    ).toBe("https://t.example/X1");
    expect(trackingLink(templates, { carrier: "other", number: "X1", url: null })).toBeNull();
    expect(CARRIERS).toContain("canada_post");
  });
});

describe("a parent's cancel (answer 2; Q5, Q6)", () => {
  const base = { isPayer: true, fulfilment: "paid", fullyRefunded: false, refundInFlight: false };
  it("is the payer's, while the order is Paid with something left to refund", () => {
    expect(canParentCancel({ ...base, fulfilment: "paid" })).toBe(true);
    expect(canParentCancel({ ...base, fulfilment: "paid", isPayer: false })).toBe(false);
    expect(canParentCancel({ ...base, fulfilment: "printed" })).toBe(false);
    expect(canParentCancel({ ...base, fulfilment: "complete" })).toBe(false);
    expect(canParentCancel({ ...base, fulfilment: "paid", fullyRefunded: true })).toBe(false);
    expect(canParentCancel({ ...base, fulfilment: "paid", refundInFlight: true })).toBe(false);
  });
});
