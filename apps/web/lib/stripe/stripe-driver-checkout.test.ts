import { afterEach, describe, expect, it, vi } from "vitest";

// The real driver's checkout and tax calls (ADR 0023), with stripe-node replaced: the checkout is created with the
// order's own idempotency key and read back with its payment, charge and balance transaction expanded; an already
// complete checkout answers its state when asked to expire; the card fee is reversed once per order (an earlier
// reversal is found by its metadata); the card prefix is DBL; tax calls go to the studio's own account. Nothing
// personal is logged.
vi.mock("server-only", () => ({}));
const { client } = vi.hoisted(() => ({
  client: {
    v2: { core: { accounts: { create: vi.fn() }, accountLinks: { create: vi.fn() } } },
    accounts: { retrieve: vi.fn(), update: vi.fn(), createLoginLink: vi.fn() },
    payouts: { retrieve: vi.fn() },
    checkout: { sessions: { create: vi.fn(), retrieve: vi.fn(), expire: vi.fn() } },
    paymentIntents: { update: vi.fn() },
    transfers: { listReversals: vi.fn(), createReversal: vi.fn() },
    tax: { settings: { update: vi.fn() }, registrations: { create: vi.fn(), update: vi.fn() } },
  },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    type: string;
    code: string | undefined;
    constructor(message: string, type = "StripeInvalidRequestError") {
      super(message);
      this.type = type;
      this.code = undefined;
    }
  }
  function Stripe() {
    return client;
  }
  Stripe.errors = { StripeError };
  return { default: Stripe };
});

const { stripeDriver, checkoutFacts } = await import("./stripe-driver");
const { default: Stripe } = await import("stripe");
const StripeError = (
  Stripe as unknown as { errors: { StripeError: new (m: string, type?: string) => Error } }
).errors.StripeError;
const driver = stripeDriver("sk_test_x", false);

/** A paid checkout as Stripe answers it with the expansion; personal fields included, to show they stay in memory. */
const paidSession = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_1",
  object: "checkout.session",
  status: "complete",
  payment_status: "paid",
  livemode: false,
  url: null,
  expires_at: 1_791_001_860,
  currency: "cad",
  amount_subtotal: 10_000,
  amount_total: 12_650,
  shipping_cost: {
    amount_subtotal: 1_195,
    amount_tax: 155,
    amount_total: 1_350,
    shipping_rate: "shr_1",
  },
  total_details: { amount_discount: 0, amount_shipping: 1_195, amount_tax: 1_455 },
  metadata: { daybell_order_id: "o-1", daybell_studio_id: "s-1", daybell_region: "ca" },
  customer_details: { email: "parent@example.test", name: "Priya Patel" },
  collected_information: {
    shipping_details: {
      name: "Priya Patel",
      address: {
        line1: "12 Maple Lane",
        line2: null,
        city: "Toronto",
        state: "ON",
        postal_code: "M5V 2T6",
        country: "CA",
      },
    },
  },
  payment_intent: {
    id: "pi_1",
    application_fee_amount: 300,
    transfer_data: { destination: "acct_A1" },
    latest_charge: {
      id: "ch_1",
      transfer: "tr_1",
      balance_transaction: { id: "txn_1", fee: 397, currency: "cad" },
    },
  },
  ...over,
});

afterEach(() => vi.clearAllMocks());

describe("checkout (ADR 0023)", () => {
  it("creates the checkout with the order's own idempotency key and answers its id, address and expiry", async () => {
    client.checkout.sessions.create.mockResolvedValue({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expires_at: 1_791_001_860,
    });
    const params = { mode: "payment" as const };
    expect(await driver.createCheckoutSession(params, "daybell-checkout-o-1")).toEqual({
      id: "cs_test_1",
      url: "https://checkout.stripe.com/c/pay/cs_test_1",
      expiresAt: 1_791_001_860,
    });
    expect(client.checkout.sessions.create).toHaveBeenCalledWith(params, {
      idempotencyKey: "daybell-checkout-o-1",
    });
  });

  it("reads a checkout with its payment, charge and Stripe's fee in one call", async () => {
    client.checkout.sessions.retrieve.mockResolvedValue(paidSession());
    const facts = await driver.retrieveCheckoutSession("cs_test_1");
    expect(client.checkout.sessions.retrieve).toHaveBeenCalledWith("cs_test_1", {
      expand: ["payment_intent.latest_charge.balance_transaction"],
    });
    expect(facts).toMatchObject({
      id: "cs_test_1",
      status: "complete",
      paymentStatus: "paid",
      amountSubtotal: 10_000,
      amountShipping: 1_195,
      amountTax: 1_455,
      amountTotal: 12_650,
      orderId: "o-1",
      studioId: "s-1",
      region: "ca",
      paymentIntentId: "pi_1",
      chargeId: "ch_1",
      transferId: "tr_1",
      destination: "acct_A1",
      applicationFeeAmount: 300,
      balanceTransaction: { id: "txn_1", feeCents: 397, currency: "cad" },
    });
  });

  it("keeps the email and the recipient for their one use each, and no other personal field", () => {
    const facts = checkoutFacts(paidSession() as never);
    expect(facts.receiptEmail).toBe("parent@example.test");
    expect(facts.shipping).toEqual({
      name: "Priya Patel",
      line1: "12 Maple Lane",
      line2: null,
      city: "Toronto",
      state: "ON",
      postalCode: "M5V 2T6",
      country: "CA",
    });
    const { receiptEmail: _e, shipping: _s, ...rest } = facts;
    expect(JSON.stringify(rest)).not.toMatch(/Priya|Patel|@|Maple/);
  });

  it("reads a checkout not yet paid, or whose fee isn't known yet, without inventing anything", () => {
    const open = checkoutFacts(
      paidSession({
        status: "open",
        payment_status: "unpaid",
        payment_intent: null,
        url: "https://checkout.stripe.com/x",
      }) as never,
    );
    expect(open).toMatchObject({
      status: "open",
      paymentIntentId: null,
      balanceTransaction: null,
      transferId: null,
    });
    const noFee = checkoutFacts(
      paidSession({
        payment_intent: {
          id: "pi_1",
          application_fee_amount: 300,
          transfer_data: { destination: "acct_A1" },
          latest_charge: { id: "ch_1", transfer: "tr_1", balance_transaction: null },
        },
      }) as never,
    );
    expect(noFee.balanceTransaction).toBeNull();
    expect(noFee.transferId).toBe("tr_1");
    // Not expanded (ids only): the ids are still read.
    const ids = checkoutFacts(paidSession({ payment_intent: "pi_2" }) as never);
    expect(ids).toMatchObject({ paymentIntentId: "pi_2", chargeId: null, destination: null });
  });

  it("expires an open checkout; one already complete answers its state instead of failing", async () => {
    client.checkout.sessions.expire.mockResolvedValueOnce({ status: "expired" });
    expect(await driver.expireCheckoutSession("cs_test_1")).toEqual({ status: "expired" });
    client.checkout.sessions.expire.mockRejectedValueOnce(new StripeError("not open"));
    client.checkout.sessions.retrieve.mockResolvedValueOnce({ status: "complete" });
    expect(await driver.expireCheckoutSession("cs_test_1")).toEqual({ status: "complete" });
  });

  it("gives Stripe the receipt address once per payment (call 18)", async () => {
    client.paymentIntents.update.mockResolvedValue({});
    await driver.setReceiptEmail("pi_1", "parent@example.test");
    expect(client.paymentIntents.update).toHaveBeenCalledWith(
      "pi_1",
      { receipt_email: "parent@example.test" },
      { idempotencyKey: "daybell-receipt-pi_1" },
    );
  });

  it("reverses Stripe's fee from the studio's transfer once per order, finding an earlier reversal first (call 1)", async () => {
    client.transfers.listReversals.mockResolvedValueOnce({ data: [] });
    client.transfers.createReversal.mockResolvedValueOnce({ id: "trr_1" });
    expect(
      await driver.recoverCardFee({ transferId: "tr_1", amountCents: 397, orderId: "o-1" }),
    ).toEqual({
      reversalId: "trr_1",
    });
    expect(client.transfers.createReversal).toHaveBeenCalledWith(
      "tr_1",
      { amount: 397, metadata: { daybell_order_id: "o-1", daybell_purpose: "card_fee" } },
      { idempotencyKey: "daybell-fee-recovery-o-1" },
    );
    client.transfers.listReversals.mockResolvedValueOnce({
      data: [{ id: "trr_1", metadata: { daybell_order_id: "o-1", daybell_purpose: "card_fee" } }],
    });
    expect(
      await driver.recoverCardFee({ transferId: "tr_1", amountCents: 397, orderId: "o-1" }),
    ).toEqual({
      reversalId: "trr_1",
    });
    expect(client.transfers.createReversal).toHaveBeenCalledTimes(1);
  });

  it("sets the studio's card prefix to DBL (call 7)", async () => {
    client.accounts.update.mockResolvedValue({});
    await driver.setCardPrefix("acct_A1");
    expect(client.accounts.update).toHaveBeenCalledWith("acct_A1", {
      settings: { card_payments: { statement_descriptor_prefix: "DBL" } },
    });
  });
});

describe("taxes (answer 2; call 3)", () => {
  it("sends the head office and registrations to the studio's own account", async () => {
    client.tax.settings.update.mockResolvedValue({});
    client.tax.registrations.create.mockResolvedValue({ id: "taxreg_1" });
    client.tax.registrations.update.mockResolvedValue({});
    await driver.setTaxHeadOffice("acct_A1", {
      line1: "12 Maple Lane",
      line2: null,
      city: "Toronto",
      province: "ON",
      postalCode: "M5V 2T6",
    });
    expect(client.tax.settings.update).toHaveBeenCalledWith(
      {
        head_office: {
          address: {
            line1: "12 Maple Lane",
            city: "Toronto",
            state: "ON",
            postal_code: "M5V 2T6",
            country: "CA",
          },
        },
      },
      { stripeContext: "acct_A1" },
    );
    expect(await driver.createTaxRegistration("acct_A1", { kind: "gst_hst" }, "k1")).toEqual({
      id: "taxreg_1",
    });
    expect(client.tax.registrations.create).toHaveBeenLastCalledWith(
      { country: "CA", active_from: "now", country_options: { ca: { type: "standard" } } },
      { stripeContext: "acct_A1", idempotencyKey: "k1" },
    );
    await driver.createTaxRegistration("acct_A1", { kind: "pst", province: "BC" }, "k2");
    expect(client.tax.registrations.create).toHaveBeenLastCalledWith(
      {
        country: "CA",
        active_from: "now",
        country_options: {
          ca: { type: "province_standard", province_standard: { province: "BC" } },
        },
      },
      { stripeContext: "acct_A1", idempotencyKey: "k2" },
    );
    await driver.expireTaxRegistration("acct_A1", "taxreg_1");
    expect(client.tax.registrations.update).toHaveBeenCalledWith(
      "taxreg_1",
      { expires_at: "now" },
      { stripeContext: "acct_A1" },
    );
  });
});
