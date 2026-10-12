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
      idempotencyKey: "k1",
    };
    const a = await fake.createAccount(input);
    expect(a.id).toMatch(/^acct_[A-Za-z0-9]+$/);
    // The same idempotency key gives the same account.
    expect((await fake.createAccount(input)).id).toBe(a.id);
    expect(accountForDatabase(a).status).toBe("needs_info");
    // Created with the default schedule, as the real driver sets it after the v2 create (D56; Q6).
    expect(accountForDatabase(a).schedule).toMatchObject({
      payout_interval: "weekly",
      weekly_anchor: "friday",
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
