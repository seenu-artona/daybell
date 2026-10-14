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
    transfers: {
      retrieve: vi.fn(),
      listReversals: vi.fn(),
      createReversal: vi.fn(),
      list: vi.fn(),
      create: vi.fn(),
    },
    paymentIntents: { retrieve: vi.fn() },
    disputes: { retrieve: vi.fn() },
  },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    type = "StripeInvalidRequestError";
    code?: string;
    statusCode?: number;
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

  it("takes what is needed, or what the transfer still holds, once per refund with its own key", async () => {
    client.transfers.listReversals.mockReturnValue([]);
    client.transfers.retrieve.mockResolvedValue({ amount: 12_650, amount_reversed: 10_450 });
    client.transfers.createReversal.mockResolvedValue({ id: "trr_1", amount: 2200 });
    expect(
      await driver.reverseForRefund({
        transferId: "tr_1",
        neededCents: 2200,
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
    // A shortfall: what is left (97 of 500), with a key per refund and sale.
    client.transfers.retrieve.mockResolvedValue({ amount: 1000, amount_reversed: 903 });
    await driver.reverseForRefund({
      transferId: "tr_2",
      neededCents: 500,
      refundId: R,
      purpose: "refund_shortfall",
      orderId: "sale-1",
    });
    expect(client.transfers.createReversal.mock.calls[1]?.[1]).toMatchObject({ amount: 97 });
    expect(client.transfers.createReversal.mock.calls[1]?.[2]).toEqual({
      idempotencyKey: `daybell-shortfall-${R}-sale-1`,
    });
  });

  it("finds an earlier reversal before looking at what is left, even when it emptied the transfer (code review B1)", async () => {
    client.transfers.listReversals.mockReturnValue([
      { id: "trr_fee", amount: 397, metadata: { daybell_purpose: "card_fee" } },
      {
        id: "trr_old",
        amount: 10_053,
        metadata: { daybell_refund_id: R, daybell_purpose: "refund" },
      },
    ]);
    client.transfers.retrieve.mockResolvedValue({ amount: 10_450, amount_reversed: 10_450 });
    expect(
      await driver.reverseForRefund({
        transferId: "tr_1",
        neededCents: 10_150,
        refundId: R,
        purpose: "refund",
        orderId: ORDER,
      }),
    ).toEqual({ reversalId: "trr_old", amountCents: 10_053 });
    expect(client.transfers.retrieve).not.toHaveBeenCalled();
    expect(client.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("finds a shortfall's earlier reversal only for the same sale", async () => {
    client.transfers.listReversals.mockReturnValue([
      {
        id: "trr_s1",
        amount: 97,
        metadata: {
          daybell_refund_id: R,
          daybell_purpose: "refund_shortfall",
          daybell_order_id: "sale-1",
        },
      },
    ]);
    expect(
      (
        await driver.reverseForRefund({
          transferId: "tr_2",
          neededCents: 97,
          refundId: R,
          purpose: "refund_shortfall",
          orderId: "sale-1",
        })
      ).reversalId,
    ).toBe("trr_s1");
    client.transfers.retrieve.mockResolvedValue({ amount: 1000, amount_reversed: 1000 });
    expect(
      await driver.reverseForRefund({
        transferId: "tr_2",
        neededCents: 97,
        refundId: R,
        purpose: "refund_shortfall",
        orderId: "sale-2",
      }),
    ).toEqual({ reversalId: null, amountCents: 0 });
    expect(client.transfers.createReversal).not.toHaveBeenCalled();
  });

  it("sends a failed refund's share back once, found by its transfer group (Q7)", async () => {
    client.transfers.list.mockResolvedValue({ data: [] });
    client.transfers.create.mockResolvedValue({ id: "tr_back" });
    expect(
      await driver.returnRefundShare({
        accountId: "acct_A1",
        amountCents: 2200,
        currency: "cad",
        refundId: R,
        orderId: ORDER,
      }),
    ).toEqual({ transferId: "tr_back" });
    expect(client.transfers.list).toHaveBeenCalledWith({
      transfer_group: `daybell-refund-return-${R}`,
      limit: 10,
    });
    expect(client.transfers.create).toHaveBeenCalledWith(
      {
        amount: 2200,
        currency: "cad",
        destination: "acct_A1",
        transfer_group: `daybell-refund-return-${R}`,
        metadata: {
          daybell_refund_id: R,
          daybell_order_id: ORDER,
          daybell_purpose: "refund_return",
        },
      },
      { idempotencyKey: `daybell-refund-return-${R}` },
    );
    client.transfers.list.mockResolvedValue({
      data: [{ id: "tr_earlier", destination: "acct_A1", metadata: { daybell_refund_id: R } }],
    });
    client.transfers.create.mockClear();
    expect(
      (
        await driver.returnRefundShare({
          accountId: "acct_A1",
          amountCents: 2200,
          currency: "cad",
          refundId: R,
          orderId: ORDER,
        })
      ).transferId,
    ).toBe("tr_earlier");
    expect(client.transfers.create).not.toHaveBeenCalled();
  });
});

describe("refusals (security review S1)", () => {
  it("says a refund already being made with the same key (409) may have happened, never refused", async () => {
    const { default: Stripe } = await import("stripe");
    const inUse = Object.assign(
      new (Stripe.errors.StripeError as unknown as new (m: string) => Error)("in use"),
      {
        code: "idempotency_key_in_use",
        statusCode: 409,
      },
    );
    client.refunds.list.mockReturnValue([]);
    client.refunds.create.mockRejectedValue(inUse);
    vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(
      driver.createRefund({
        paymentIntentId: "pi_1",
        amountCents: 100,
        refundId: R,
        orderId: ORDER,
        region: "ca",
        reason: null,
      }),
    ).rejects.toMatchObject({ outcome: "unknown" });
    const refused = new (Stripe.errors.StripeError as unknown as new (m: string) => Error)(
      "too much",
    );
    client.refunds.create.mockRejectedValue(refused);
    await expect(
      driver.createRefund({
        paymentIntentId: "pi_1",
        amountCents: 100,
        refundId: R,
        orderId: ORDER,
        region: "ca",
        reason: null,
      }),
    ).rejects.toMatchObject({ outcome: "refused", stripeType: "StripeInvalidRequestError" });
  });

  it("finds one of the payment's refunds by Daybell's id", async () => {
    client.refunds.list.mockReturnValue([refund({ id: "re_9" })]);
    expect((await driver.findRefund("pi_1", R))?.id).toBe("re_9");
    expect(await driver.findRefund("pi_1", "aaaa0000-0000-4000-8000-000000000009")).toBeNull();
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
