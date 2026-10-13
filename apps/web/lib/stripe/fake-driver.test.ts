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
