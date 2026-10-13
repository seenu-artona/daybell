import { describe, expect, it } from "vitest";
import {
  mulDivHalfUp,
  type RefundableOrder,
  type RefundedSoFar,
  RefundRefused,
  refundLedger,
  refundSplit,
  refundState,
  stripeRefundReason,
} from "./refunds";

// The worked example of ADR 0024: products 10,000, shipping 1,195, tax 1,455, total 12,650; Daybell's 3% is 300.
const order: RefundableOrder = {
  productsCents: 10_000,
  shippingCents: 1195,
  taxCents: 1455,
  daybellFeeCents: 300,
  daybellFeeBps: 300,
};
const none: RefundedSoFar = { productsCents: 0, shippingCents: 0, taxCents: 0, feeCents: 0 };
const add = (done: RefundedSoFar, s: ReturnType<typeof refundSplit>): RefundedSoFar => ({
  productsCents: done.productsCents + s.productsCents,
  shippingCents: done.shippingCents + s.shippingCents,
  taxCents: done.taxCents + s.taxCents,
  feeCents: done.feeCents + s.feeCents,
});

describe("refundSplit (ADR 0024 §split)", () => {
  it("gives back tax and Daybell's fee pro rata, half up: one print of 20.00", () => {
    // Tax 1,455 × 2,000 / 11,195 = 259.94 → 260; fee 3% of 2,000 = 60; the studio gives back 2,200.
    expect(refundSplit(order, none, { productsCents: 2000, shippingCents: 0 })).toEqual({
      productsCents: 2000,
      shippingCents: 0,
      taxCents: 260,
      feeCents: 60,
      amountCents: 2260,
      studioCents: 2200,
    });
  });

  it("lets the refund that empties the order take the exact remainders", () => {
    const first = refundSplit(order, none, { productsCents: 2000, shippingCents: 0 });
    const rest = refundSplit(order, add(none, first), { productsCents: 8000, shippingCents: 1195 });
    expect(rest).toEqual({
      productsCents: 8000,
      shippingCents: 1195,
      taxCents: 1195,
      feeCents: 240,
      amountCents: 10_390,
      studioCents: 10_150,
    });
    expect(first.amountCents + rest.amountCents).toBe(12_650);
    expect(first.feeCents + rest.feeCents).toBe(300);
  });

  it("never gives back more than is left, however the pieces round", () => {
    // Many small refunds that each round up would add up to more than the tax; the cap and the remainder stop it.
    const tiny: RefundableOrder = {
      productsCents: 100,
      shippingCents: 0,
      taxCents: 13,
      daybellFeeCents: 3,
      daybellFeeBps: 300,
    };
    let done = none;
    let total = 0;
    for (let i = 0; i < 10; i++) {
      const s = refundSplit(tiny, done, { productsCents: 10, shippingCents: 0 });
      done = add(done, s);
      total += s.amountCents;
    }
    expect(done).toEqual({ productsCents: 100, shippingCents: 0, taxCents: 13, feeCents: 3 });
    expect(total).toBe(113);
  });

  it("refuses more than is left, and nothing at all", () => {
    expect(() => refundSplit(order, none, { productsCents: 10_001, shippingCents: 0 })).toThrow(
      RefundRefused,
    );
    expect(() => refundSplit(order, none, { productsCents: 0, shippingCents: 1196 })).toThrow(
      "over_refund",
    );
    expect(() => refundSplit(order, none, { productsCents: 0, shippingCents: 0 })).toThrow(
      "nothing_to_refund",
    );
    expect(() => refundSplit(order, none, { productsCents: 1.5, shippingCents: 0 })).toThrow();
  });
});

describe("refundLedger", () => {
  it("is balanced, with zero lines left out", () => {
    const lines = refundLedger({ amountCents: 2260, taxCents: 260, feeCents: 60 });
    expect(lines).toEqual([
      { account: "refunds", cents: -2260 },
      { account: "tax_payable", cents: 260 },
      { account: "daybell_fees", cents: 60 },
      { account: "studio_payable", cents: 1940 },
    ]);
    expect(lines.reduce((sum, l) => sum + l.cents, 0)).toBe(0);
    expect(refundLedger({ amountCents: 500, taxCents: 0, feeCents: 0 })).toEqual([
      { account: "refunds", cents: -500 },
      { account: "studio_payable", cents: 500 },
    ]);
  });

  it("leaves the studio bearing exactly Stripe's card fee across a full refund (answer 1)", () => {
    const stripeFee = 397;
    const paidStudio = -(12_650 - 1455 - 300 - stripeFee);
    const first = refundSplit(order, none, { productsCents: 2000, shippingCents: 0 });
    const rest = refundSplit(order, add(none, first), { productsCents: 8000, shippingCents: 1195 });
    const studio = [first, rest]
      .flatMap((s) => refundLedger(s))
      .filter((l) => l.account === "studio_payable")
      .reduce((sum, l) => sum + l.cents, paidStudio);
    expect(studio).toBe(stripeFee);
  });
});

describe("refund badges and Stripe's reason", () => {
  it("says Refunded or Partly refunded apart from the status", () => {
    expect(refundState(12_650, 0)).toBeNull();
    expect(refundState(12_650, 2260)).toBe("partly_refunded");
    expect(refundState(12_650, 12_650)).toBe("refunded");
  });

  it("tells Stripe a parent asked only when they did, and never fraudulent", () => {
    expect(stripeRefundReason("cancel", "parent_asked")).toBe("requested_by_customer");
    expect(stripeRefundReason("lines", "parent_asked")).toBe("requested_by_customer");
    expect(stripeRefundReason("custom", "duplicate")).toBe("duplicate");
    expect(stripeRefundReason("lines", "damaged")).toBeNull();
    expect(stripeRefundReason("lines", null)).toBeNull();
  });

  it("rounds half up without floats", () => {
    expect(mulDivHalfUp(1455, 2000, 11_195)).toBe(260);
    expect(mulDivHalfUp(1, 1, 2)).toBe(1);
    expect(mulDivHalfUp(Number.MAX_SAFE_INTEGER, 2, 2)).toBe(Number.MAX_SAFE_INTEGER);
  });
});
