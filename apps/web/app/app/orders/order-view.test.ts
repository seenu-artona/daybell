import { describe, expect, it } from "vitest";
import { deliveryFrom, orderViewHref, statusFrom } from "./order-view";

describe("the Orders view in the address (D144, D113)", () => {
  it("keeps only known statuses and deliveries", () => {
    expect(statusFrom("paid")).toBe("paid");
    expect(statusFrom("7KQ2M9XA")).toBe("");
    expect(statusFrom(null)).toBe("");
    expect(deliveryFrom("school")).toBe("school");
    expect(deliveryFrom("anywhere")).toBe("");
  });

  it("links each view to the page's own path with ?status=", () => {
    expect(orderViewHref("/app/orders", "")).toBe("/app/orders");
    expect(orderViewHref("/app/orders", "printed")).toBe("/app/orders?status=printed");
    expect(orderViewHref("/app/jobs/j1/orders", "paid")).toBe("/app/jobs/j1/orders?status=paid");
  });
});
