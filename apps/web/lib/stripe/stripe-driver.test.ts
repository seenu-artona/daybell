import { describe, expect, it, vi } from "vitest";

// The real driver's calls (ADR 0020), with stripe-node replaced: the exact controller properties Seenu chose (Q1, Q2),
// country only (Q4), the pinned API version, the idempotency key, account_onboarding links and the connected
// account's context for payouts.
vi.mock("server-only", () => ({}));
const { created, client } = vi.hoisted(() => ({
  created: [] as unknown[],
  client: {
    accounts: {
      create: vi.fn().mockResolvedValue({ id: "acct_1" }),
      retrieve: vi.fn().mockResolvedValue({ id: "acct_1" }),
      update: vi.fn().mockResolvedValue({ id: "acct_1" }),
      createLoginLink: vi.fn().mockResolvedValue({ url: "https://x" }),
    },
    accountLinks: { create: vi.fn().mockResolvedValue({ url: "https://y", expires_at: 5 }) },
    payouts: { retrieve: vi.fn().mockResolvedValue({ id: "po_1" }) },
  },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    type = "StripeAPIError";
  }
  function Stripe(this: unknown, ...args: unknown[]) {
    created.push(args);
    return client;
  }
  Stripe.errors = { StripeError };
  return { default: Stripe };
});

const { stripeDriver, STRIPE_API_VERSION } = await import("./stripe-driver");

describe("stripeDriver", () => {
  // Built at run time so secret scanners never see a key-shaped literal.
  const KEY = ["sk", "test", "123"].join("_");
  const driver = stripeDriver(KEY, false);

  it("pins the API version and turns telemetry off", () => {
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    expect(created[0]).toEqual([
      KEY,
      { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2, timeout: 10_000, telemetry: false },
    ]);
  });

  it("creates the account with exactly Seenu's controller properties, the country and Daybell's ids only", async () => {
    await driver.createAccount({
      studioId: "studio-1",
      region: "ca",
      country: "CA",
      idempotencyKey: "daybell-payout-account-studio-1",
    });
    expect(client.accounts.create).toHaveBeenCalledWith(
      {
        country: "CA",
        controller: {
          requirement_collection: "stripe",
          losses: { payments: "application" },
          fees: { payer: "application" },
          stripe_dashboard: { type: "express" },
        },
        capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
        metadata: { daybell_studio_id: "studio-1", daybell_region: "ca" },
        settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } },
      },
      { idempotencyKey: "daybell-payout-account-studio-1" },
    );
  });

  it("makes onboarding links, schedules, payout reads and login links as Stripe expects", async () => {
    expect(
      await driver.createAccountLink({
        accountId: "acct_1",
        refreshUrl: "https://r",
        returnUrl: "https://b",
      }),
    ).toEqual({ url: "https://y", expiresAt: 5 });
    expect(client.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_1",
      type: "account_onboarding",
      refresh_url: "https://r",
      return_url: "https://b",
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "weekly", weeklyAnchor: "monday" });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "monday" } } },
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "monthly", monthlyAnchor: 31 });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "monthly", monthly_anchor: 31 } } },
    });
    await driver.retrievePayout("acct_1", "po_1");
    expect(client.payouts.retrieve).toHaveBeenCalledWith("po_1", {}, { stripeContext: "acct_1" });
    expect(await driver.createLoginLink("acct_1")).toEqual({ url: "https://x" });
  });

  it("turns Stripe's errors into a plain internal error, logging the error type only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { default: Stripe } = await import("stripe");
    const err = new (
      Stripe as unknown as { errors: { StripeError: new (m: string) => Error } }
    ).errors.StripeError("No such account: acct_1 for jane@example.test");
    client.accounts.retrieve.mockRejectedValueOnce(err);
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenCalledWith("stripe_error", "StripeAPIError");
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
    log.mockRestore();
  });
});
