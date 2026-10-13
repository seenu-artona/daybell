import { afterEach, describe, expect, it, vi } from "vitest";

// The real driver's refund calls (ADR 0024; Q1), with stripe-node replaced: a refund is Daybell's exact amount on the
// payment, with Daybell's ids in its metadata and its own key, and never reverse_transfer, refund_application_fee or
// "fraudulent"; one made by an earlier try is found by its metadata first; the studio's share is reversed once per
// refund (and per sale for a shortfall); a transfer's remaining amount is what it holds less what was reversed; a
// refund's facts carry only ids, its status and an identifier as the failure reason.
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({
  client: {
    refunds: { list: vi.fn(), create: vi.fn(), retrieve: vi.fn() },
    transfers: { retrieve: vi.fn(), listReversals: vi.fn(), createReversal: vi.fn() },
    paymentIntents: { retrieve: vi.fn() },
    disputes: { retrieve: vi.fn() },
  },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    type = "StripeInvalidRequestError";
  }
  function Stripe() {
    return client;
  }
  Stripe.errors = { StripeError };
  return { default: Stripe };
});

const { stripeDriver, refundFacts } = await import("./stripe-driver");
const driver = stripeDriver("sk_test_x", false);
const R = "aaaa0000-0000-4000-8000-000000000001";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";

const refund = (over: Record<string, unknown> = {}) => ({
  id: "re_1",
  object: "refund",
  amount: 2260,
  currency: "cad",
  status: "succeeded",
  payment_intent: "pi_1",
  metadata: { daybell_refund_id: R, daybell_order_id: ORDER, daybell_region: "ca" },
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("createRefund (Q1)", () => {
  it("asks Stripe for Daybell's amount with its ids and key, and no flags", async () => {
    client.refunds.list.mockReturnValue([]);
    client.refunds.create.mockResolvedValue(refund());
    const facts = await driver.createRefund({
      paymentIntentId: "pi_1",
      amountCents: 2260,
      refundId: R,
      orderId: ORDER,
      region: "ca",
      reason: "requested_by_customer",
    });
    expect(client.refunds.list).toHaveBeenCalledWith({ payment_intent: "pi_1", limit: 100 });
    expect(client.refunds.create).toHaveBeenCalledWith(
      {
        payment_intent: "pi_1",
        amount: 2260,
        metadata: { daybell_refund_id: R, daybell_order_id: ORDER, daybell_region: "ca" },
        reason: "requested_by_customer",
      },
      { idempotencyKey: `daybell-refund-${R}` },
    );
    const params = client.refunds.create.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(params).not.toHaveProperty("reverse_transfer");
    expect(params).not.toHaveProperty("refund_application_fee");
    expect(facts).toEqual({
      id: "re_1",
      status: "succeeded",
      amountCents: 2260,
      currency: "cad",
      paymentIntentId: "pi_1",
      refundId: R,
      orderId: ORDER,
      region: "ca",
      failureReason: null,
    });
  });

  it("sends no reason unless there is one", async () => {
    client.refunds.list.mockReturnValue([]);
    client.refunds.create.mockResolvedValue(refund());
    await driver.createRefund({
      paymentIntentId: "pi_1",
      amountCents: 100,
      refundId: R,
      orderId: ORDER,
      region: "ca",
      reason: null,
    });
    expect(client.refunds.create.mock.calls[0]?.[0]).not.toHaveProperty("reason");
  });

  it("finds a refund an earlier try made, even after Stripe's key expired", async () => {
    client.refunds.list.mockReturnValue([refund({ id: "re_old" })]);
    const facts = await driver.createRefund({
      paymentIntentId: "pi_1",
      amountCents: 2260,
      refundId: R,
      orderId: ORDER,
      region: "ca",
      reason: null,
    });
    expect(facts.id).toBe("re_old");
    expect(client.refunds.create).not.toHaveBeenCalled();
  });

  it("reads only ids, the status and an identifier from a refund", () => {
    expect(
      refundFacts(
        refund({ status: "failed", failure_reason: "Card closed by Priya", metadata: {} }) as never,
      ),
    ).toMatchObject({ status: "failed", failureReason: "other", refundId: null, orderId: null });
    expect(refundFacts(refund({ status: "weird" }) as never).status).toBe("other");
  });
});

describe("the studio's share (Q1, Q2)", () => {
  it("knows what a transfer still holds", async () => {
    client.transfers.retrieve.mockResolvedValue({
      amount: 12_650,
      amount_reversed: 397,
      currency: "cad",
    });
    expect(await driver.transferRemaining("tr_1")).toEqual({
      remainingCents: 12_253,
      currency: "cad",
    });
  });

  it("reverses once per refund, with its ids and its own key; a shortfall once per sale", async () => {
    client.transfers.listReversals.mockReturnValue([]);
    client.transfers.createReversal.mockResolvedValue({ id: "trr_1", amount: 2200 });
    expect(
      await driver.reverseForRefund({
        transferId: "tr_1",
        amountCents: 2200,
        refundId: R,
        purpose: "refund",
        orderId: ORDER,
      }),
    ).toEqual({ reversalId: "trr_1", amountCents: 2200 });
    expect(client.transfers.createReversal).toHaveBeenCalledWith(
      "tr_1",
      {
        amount: 2200,
        metadata: { daybell_refund_id: R, daybell_order_id: ORDER, daybell_purpose: "refund" },
      },
      { idempotencyKey: `daybell-refund-reversal-${R}` },
    );
    await driver.reverseForRefund({
      transferId: "tr_2",
      amountCents: 97,
      refundId: R,
      purpose: "refund_shortfall",
      orderId: "sale-1",
    });
    expect(client.transfers.createReversal.mock.calls[1]?.[2]).toEqual({
      idempotencyKey: `daybell-shortfall-${R}-sale-1`,
    });
  });

  it("finds an earlier reversal by its metadata instead of making another", async () => {
    client.transfers.listReversals.mockReturnValue([
      { id: "trr_fee", amount: 397, metadata: { daybell_purpose: "card_fee" } },
      {
        id: "trr_old",
        amount: 2200,
        metadata: { daybell_refund_id: R, daybell_purpose: "refund" },
      },
    ]);
    expect(
      await driver.reverseForRefund({
        transferId: "tr_1",
        amountCents: 2200,
        refundId: R,
        purpose: "refund",
        orderId: ORDER,
      }),
    ).toEqual({ reversalId: "trr_old", amountCents: 2200 });
    expect(client.transfers.createReversal).not.toHaveBeenCalled();
  });
});

describe("payments and disputes", () => {
  it("reads a payment's Daybell ids and its refunds", async () => {
    client.paymentIntents.retrieve.mockResolvedValue({
      id: "pi_1",
      metadata: { daybell_order_id: ORDER, daybell_studio_id: "s", daybell_region: "ca" },
    });
    client.refunds.list.mockReturnValue([refund()]);
    expect(await driver.retrievePaymentIntentIds("pi_1")).toMatchObject({
      id: "pi_1",
      orderId: ORDER,
      studioId: "s",
      region: "ca",
      refunds: [{ id: "re_1", refundId: R }],
    });
  });

  it("reads a dispute's payment", async () => {
    client.disputes.retrieve.mockResolvedValue({ id: "dp_1", payment_intent: { id: "pi_1" } });
    expect(await driver.retrieveDispute("dp_1")).toEqual({ id: "dp_1", paymentIntentId: "pi_1" });
  });
});
