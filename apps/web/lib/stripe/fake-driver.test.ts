import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { fakeDriver, fakeFinishOnboarding, fakePaidPayout, fakeReturnUrl } = await import(
  "./fake-driver"
);
const { accountForDatabase } = await import("../payouts");

describe("fakeDriver (ADR 0020)", () => {
  it("behaves like the parts of Stripe Daybell uses", async () => {
    const fake = fakeDriver();
    const input = {
      studioId: "s1",
      region: "ca" as const,
      country: "CA" as const,
      contactEmail: "maya.owner@example.test",
      idempotencyKey: "k1",
    };
    const created = await fake.createAccount(input);
    // The id only, like the real driver's v2 create (security review 1).
    expect(Object.keys(created)).toEqual(["id"]);
    expect(created.id).toMatch(/^acct_[A-Za-z0-9]+$/);
    // The same idempotency key gives the same account.
    expect((await fake.createAccount(input)).id).toBe(created.id);
    const a = await fake.retrieveAccount(created.id);
    expect(accountForDatabase(a).status).toBe("needs_info");
    // Stripe's own schedule, not marked as set by Daybell, until Daybell sets its default (D56; Q6).
    expect(accountForDatabase(a).schedule).toMatchObject({ payout_interval: "daily" });
    expect(a.metadata).toEqual({ daybell_studio_id: "s1", daybell_region: "ca" });
    // The contact email is accepted and never kept (step 7c).
    expect(JSON.stringify(a)).not.toContain("maya");
    const scheduled = await fake.updatePayoutSchedule(a.id, {
      interval: "weekly",
      weeklyAnchor: "friday",
    });
    expect(accountForDatabase(scheduled).schedule).toMatchObject({
      payout_interval: "weekly",
      weekly_anchor: "friday",
    });
    expect(scheduled.metadata).toEqual({
      daybell_studio_id: "s1",
      daybell_region: "ca",
      daybell_schedule_set: "true",
    });
    // Another key (e.g. the v2 key after the v1 one) is another request.
    expect((await fake.createAccount({ ...input, idempotencyKey: "k2" })).id).not.toBe(a.id);
    const link = await fake.createAccountLink({
      accountId: a.id,
      refreshUrl: "http://x/refresh",
      returnUrl: "http://x/return",
    });
    expect(link.url).toContain("/dev/stripe-onboarding?account=");
    expect(fakeReturnUrl(a.id)).toBe("http://x/return");
    fakeFinishOnboarding(a.id);
    expect(accountForDatabase(await fake.retrieveAccount(a.id)).status).toBe("active");
    const updated = await fake.updatePayoutSchedule(a.id, {
      interval: "monthly",
      monthlyAnchor: 1,
    });
    expect(accountForDatabase(updated).schedule).toEqual({
      payout_interval: "monthly",
      weekly_anchor: null,
      monthly_anchor: 1,
      delay_days: 2,
    });
    const po = fakePaidPayout(a.id, "cad");
    expect(po).toMatch(/^po_[A-Za-z0-9]+$/);
    expect(await fake.retrievePayout(a.id, po)).toMatchObject({
      amount: 12345,
      currency: "cad",
      status: "paid",
    });
    await expect(fake.retrievePayout("acct_other", po)).rejects.toThrow();
  });
});

describe("fakeDriver checkout (ADR 0023)", () => {
  const params = {
    mode: "payment" as const,
    line_items: [
      {
        quantity: 2,
        price_data: { currency: "cad", unit_amount: 1300, product_data: { name: "4×6 print" } },
      },
    ],
    shipping_address_collection: { allowed_countries: ["CA" as const] },
    shipping_options: [
      {
        shipping_rate_data: {
          type: "fixed_amount" as const,
          display_name: "Home delivery",
          fixed_amount: { amount: 1195, currency: "cad" },
        },
      },
    ],
    automatic_tax: { enabled: true },
    payment_intent_data: {
      application_fee_amount: 78,
      on_behalf_of: "acct_X",
      transfer_data: { destination: "acct_X" },
    },
    metadata: { daybell_order_id: "o-1", daybell_studio_id: "s-1", daybell_region: "ca" },
    success_url: "http://localhost/shop/orders/o-1",
    cancel_url: "http://localhost/shop/bag?checkout=canceled",
    expires_at: Math.floor(Date.now() / 1000) + 1860,
  };

  it("makes one checkout per key, and its page is this deployment's fake one", async () => {
    const fake = fakeDriver();
    const a = await fake.createCheckoutSession(params, "daybell-checkout-o-1");
    const b = await fake.createCheckoutSession(params, "daybell-checkout-o-1");
    expect(b.id).toBe(a.id);
    expect(a.id).toMatch(/^cs_test_fake[A-Za-z0-9]+$/);
    expect(a.url).toMatch(/\/dev\/stripe-checkout\?session=cs_test_fake/);
    expect((await fake.retrieveCheckoutSession(a.id)).status).toBe("open");
  });

  it("pays like Stripe: 13% tax with Stripe Tax on, a 2.9% + 30¢ fee, a transfer to the destination", async () => {
    const { fakePayCheckout, fakeReceipts, fakeReversal, fakeTax, fakeCardFee } = await import(
      "./fake-driver"
    );
    const fake = fakeDriver();
    const { id } = await fake.createCheckoutSession(params, "daybell-checkout-o-2");
    expect(() => fakePayCheckout(id, { email: "p@example.test", shipping: null })).toThrow(
      "fake_stripe_address_needed",
    );
    const shipping = {
      name: "Test Parent",
      line1: "1 Test Street",
      line2: null,
      city: "Toronto",
      state: "ON",
      postalCode: "M5V 2T6",
      country: "CA",
    };
    expect(fakePayCheckout(id, { email: "p@example.test", shipping })).toBe(params.success_url);
    const facts = await fake.retrieveCheckoutSession(id);
    const tax = fakeTax(2600 + 1195, true);
    expect(tax).toBe(493);
    expect(facts).toMatchObject({
      status: "complete",
      paymentStatus: "paid",
      amountSubtotal: 2600,
      amountShipping: 1195,
      amountTax: tax,
      amountTotal: 2600 + 1195 + tax,
      destination: "acct_X",
      onBehalfOf: "acct_X",
      applicationFeeAmount: 78,
      orderId: "o-1",
      shipping,
    });
    expect(facts.balanceTransaction?.feeCents).toBe(fakeCardFee(2600 + 1195 + tax));
    // A paid checkout can't be expired, or paid again.
    expect(await fake.expireCheckoutSession(id)).toEqual({ status: "complete" });
    expect(() => fakePayCheckout(id, { email: "p@example.test", shipping })).toThrow();
    // The receipt is counted, never kept by address; the fee is reversed once per order.
    await fake.setReceiptEmail(facts.paymentIntentId as string, "p@example.test");
    expect(fakeReceipts(facts.paymentIntentId as string)).toBe(1);
    const first = await fake.recoverCardFee({
      transferId: "tr_x",
      amountCents: 140,
      orderId: "o-2",
    });
    const again = await fake.recoverCardFee({
      transferId: "tr_x",
      amountCents: 140,
      orderId: "o-2",
    });
    expect(again).toEqual(first);
    expect(fakeReversal("o-2")?.amount).toBe(140);
  });

  it("expires an open checkout and sends a cancelled parent back to the bag", async () => {
    const { fakeCancelCheckout } = await import("./fake-driver");
    const fake = fakeDriver();
    const { id } = await fake.createCheckoutSession(params, "daybell-checkout-o-3");
    expect(fakeCancelCheckout(id)).toBe(params.cancel_url);
    expect(await fake.expireCheckoutSession(id)).toEqual({ status: "expired" });
  });

  it("refunds and reverses like Stripe (ADR 0024): never more than was paid or transferred", async () => {
    const { fakePayCheckout, fakeFailRefund, fakeOpenDispute, fakeTransferReversals } =
      await import("./fake-driver");
    const fake = fakeDriver();
    const { id } = await fake.createCheckoutSession(params, "daybell-checkout-o-4");
    fakePayCheckout(id, {
      email: "p@example.test",
      shipping: {
        name: "Test Parent",
        line1: "1 Test Street",
        line2: null,
        city: "Toronto",
        state: "ON",
        postalCode: "M5V 2T6",
        country: "CA",
      },
    });
    const facts = await fake.retrieveCheckoutSession(id);
    const pi = facts.paymentIntentId as string;
    const tr = facts.transferId as string;
    const total = facts.amountTotal as number;
    expect(await fake.retrievePaymentIntentIds(pi)).toMatchObject({
      orderId: "o-1",
      studioId: "s-1",
      region: "ca",
      refunds: [],
    });
    const request = { paymentIntentId: pi, orderId: "o-1", region: "ca", reason: null };
    const one = await fake.createRefund({ ...request, amountCents: 1000, refundId: "r-1" });
    expect(one).toMatchObject({ status: "succeeded", amountCents: 1000, refundId: "r-1" });
    // The same Daybell refund again is the same refund.
    expect((await fake.createRefund({ ...request, amountCents: 1000, refundId: "r-1" })).id).toBe(
      one.id,
    );
    await expect(
      fake.createRefund({ ...request, amountCents: total, refundId: "r-2" }),
    ).rejects.toMatchObject({ outcome: "refused", stripeType: "StripeInvalidRequestError" });
    // The transfer holds the total; the card fee's reversal and the refund's come off it.
    await fake.recoverCardFee({ transferId: tr, amountCents: 140, orderId: "o-1" });
    expect(await fake.transferRemaining(tr)).toEqual({
      remainingCents: total - 140,
      currency: "cad",
    });
    const reversal = await fake.reverseForRefund({
      transferId: tr,
      amountCents: 900,
      refundId: "r-1",
      purpose: "refund",
      orderId: "o-1",
    });
    expect(
      await fake.reverseForRefund({
        transferId: tr,
        amountCents: 900,
        refundId: "r-1",
        purpose: "refund",
        orderId: "o-1",
      }),
    ).toEqual(reversal);
    await expect(
      fake.reverseForRefund({
        transferId: tr,
        amountCents: total,
        refundId: "r-3",
        purpose: "refund",
        orderId: "o-1",
      }),
    ).rejects.toMatchObject({ outcome: "refused" });
    expect(fakeTransferReversals(tr).map((r) => r.purpose)).toEqual(["card_fee", "refund"]);
    // A refund Stripe fails later, and a dispute.
    expect(fakeFailRefund(one.id)?.status).toBe("failed");
    expect((await fake.retrieveRefund(one.id)).status).toBe("failed");
    expect(fakeFailRefund("re_nope")).toBeNull();
    const dispute = fakeOpenDispute(pi);
    expect(await fake.retrieveDispute(dispute)).toEqual({ id: dispute, paymentIntentId: pi });
  });
});
