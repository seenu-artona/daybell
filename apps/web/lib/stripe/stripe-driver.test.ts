import { afterEach, describe, expect, it, vi } from "vitest";

// The real driver's calls (ADR 0020 and its amendment), with stripe-node replaced: accounts are created with Accounts
// v2 (dashboard express, Daybell collecting fees and carrying losses: Seenu, Q1 and Q2), country and currency only
// (Q4), the pinned API version, the v2 idempotency key, v2 onboarding links, and the v1 endpoints (with the v2 account
// id) for the schedule, reads, payouts and login links. Stripe errors are logged by type and code only; codes that mean
// Daybell's platform setup isn't finished get their own form code.
vi.mock("server-only", () => ({}));
const { created, client } = vi.hoisted(() => ({
  created: [] as unknown[],
  client: {
    v2: {
      core: {
        accounts: { create: vi.fn() },
        accountLinks: { create: vi.fn() },
      },
    },
    accounts: {
      create: vi.fn(),
      retrieve: vi.fn(),
      update: vi.fn(),
      createLoginLink: vi.fn(),
    },
    accountLinks: { create: vi.fn() },
    payouts: { retrieve: vi.fn() },
  },
}));
vi.mock("stripe", () => {
  class StripeError extends Error {
    type = "StripeInvalidRequestError";
    code: string | undefined;
    constructor(message: string, code?: string) {
      super(message);
      this.code = code;
    }
  }
  function Stripe(this: unknown, ...args: unknown[]) {
    created.push(args);
    return client;
  }
  Stripe.errors = { StripeError };
  return { default: Stripe };
});

const { stripeDriver, STRIPE_API_VERSION, PLATFORM_SETUP_CODES } = await import("./stripe-driver");
const { default: Stripe } = await import("stripe");
const StripeError = (
  Stripe as unknown as {
    errors: { StripeError: new (message: string, code?: string) => Error };
  }
).errors.StripeError;

const resetClient = () => {
  client.v2.core.accounts.create.mockReset().mockResolvedValue({ id: "acct_1" });
  client.v2.core.accountLinks.create
    .mockReset()
    .mockResolvedValue({ url: "https://y", expires_at: "2026-10-12T17:05:00.000Z" });
  client.accounts.retrieve.mockReset().mockResolvedValue({ id: "acct_1" });
  client.accounts.update.mockReset().mockResolvedValue({ id: "acct_1", v1: true });
  client.accounts.createLoginLink.mockReset().mockResolvedValue({ url: "https://x" });
  client.payouts.retrieve.mockReset().mockResolvedValue({ id: "po_1" });
};
resetClient();
afterEach(resetClient);

describe("stripeDriver", () => {
  // Built at run time so secret scanners never see a key-shaped literal.
  const KEY = ["sk", "test", "123"].join("_");
  const driver = stripeDriver(KEY, false);
  const newAccount = {
    studioId: "studio-1",
    region: "ca" as const,
    country: "CA" as const,
    idempotencyKey: "daybell-payout-account-v2-studio-1",
  };

  it("pins the API version and turns telemetry off", () => {
    expect(STRIPE_API_VERSION).toBe("2026-08-26.dahlia");
    expect(created[0]).toEqual([
      KEY,
      { apiVersion: "2026-08-26.dahlia", maxNetworkRetries: 2, timeout: 10_000, telemetry: false },
    ]);
  });

  it("creates the account with Accounts v2: Seenu's responsibilities, express dashboard, country, currency and ids only", async () => {
    expect(await driver.createAccount(newAccount)).toEqual({ id: "acct_1", v1: true });
    expect(client.v2.core.accounts.create).toHaveBeenCalledWith(
      {
        identity: { country: "ca" },
        dashboard: "express",
        defaults: {
          currency: "cad",
          responsibilities: { fees_collector: "application", losses_collector: "application" },
        },
        configuration: {
          merchant: { capabilities: { card_payments: { requested: true } } },
          recipient: {
            capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
          },
        },
        metadata: { daybell_studio_id: "studio-1", daybell_region: "ca" },
      },
      { idempotencyKey: "daybell-payout-account-v2-studio-1" },
    );
    // No v1 account creation, and nothing personal (no name, email or business details; Q4).
    expect(client.accounts.create).not.toHaveBeenCalled();
    const sent = JSON.stringify(client.v2.core.accounts.create.mock.calls);
    for (const field of ["display_name", "contact_email", "business_details", "individual"])
      expect(sent).not.toContain(field);
    // Then the default schedule through v1 with the v2 id: weekly on Friday, Stripe's own delay (D56; Q6). Its answer
    // is the v1-shaped account Daybell records.
    expect(client.accounts.update).toHaveBeenCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } },
    });
  });

  it("logs the studio id (only) when the schedule fails after Stripe made the account, so support can find it", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    client.accounts.update.mockRejectedValueOnce(new StripeError("acct_1 owner jane@example.test"));
    await expect(driver.createAccount(newAccount)).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenCalledWith("stripe_account_unrecorded", "studio-1");
    expect(JSON.stringify(log.mock.calls)).not.toContain("acct_1");
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
    log.mockRestore();
  });

  it("makes v2 onboarding links for both configurations, and turns Stripe's RFC 3339 expiry into seconds", async () => {
    expect(
      await driver.createAccountLink({
        accountId: "acct_1",
        refreshUrl: "https://r",
        returnUrl: "https://b",
      }),
    ).toEqual({ url: "https://y", expiresAt: Date.parse("2026-10-12T17:05:00.000Z") / 1000 });
    expect(client.v2.core.accountLinks.create).toHaveBeenCalledWith({
      account: "acct_1",
      use_case: {
        type: "account_onboarding",
        account_onboarding: {
          configurations: ["merchant", "recipient"],
          refresh_url: "https://r",
          return_url: "https://b",
        },
      },
    });
    expect(client.accountLinks.create).not.toHaveBeenCalled();
  });

  it("refuses a link whose expiry it can't read", async () => {
    client.v2.core.accountLinks.create.mockResolvedValueOnce({
      url: "https://y",
      expires_at: "soon",
    });
    await expect(
      driver.createAccountLink({
        accountId: "acct_1",
        refreshUrl: "https://r",
        returnUrl: "https://b",
      }),
    ).rejects.toMatchObject({ code: "internal" });
  });

  it("uses v1 with the v2 account id for schedules, reads, payouts and login links", async () => {
    await driver.updatePayoutSchedule("acct_1", { interval: "weekly", weeklyAnchor: "monday" });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "monday" } } },
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "monthly", monthlyAnchor: 31 });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "monthly", monthly_anchor: 31 } } },
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "daily" });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "daily" } } },
    });
    await driver.retrieveAccount("acct_1");
    expect(client.accounts.retrieve).toHaveBeenCalledWith("acct_1");
    await driver.retrievePayout("acct_1", "po_1");
    expect(client.payouts.retrieve).toHaveBeenCalledWith("po_1", {}, { stripeContext: "acct_1" });
    expect(await driver.createLoginLink("acct_1")).toEqual({ url: "https://x" });
    expect(client.accounts.createLoginLink).toHaveBeenCalledWith("acct_1");
  });

  it("turns Stripe's errors into a plain internal error, logging the error type and code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    client.accounts.retrieve.mockRejectedValueOnce(
      new StripeError("No such account: acct_1 for jane@example.test", "resource_missing"),
    );
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({
      code: "internal",
      fields: undefined,
    });
    expect(log).toHaveBeenCalledWith(
      "stripe_error",
      "StripeInvalidRequestError",
      "resource_missing",
    );
    client.accounts.retrieve.mockRejectedValueOnce(new StripeError("no code"));
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenLastCalledWith("stripe_error", "StripeInvalidRequestError", "none");
    // A code that isn't one of Stripe's identifiers is never logged as given.
    client.accounts.retrieve.mockRejectedValueOnce(new StripeError("x", "jane@example.test"));
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenLastCalledWith("stripe_error", "StripeInvalidRequestError", "other");
    client.accounts.retrieve.mockRejectedValueOnce(new Error("socket"));
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenLastCalledWith("stripe_error", "unknown", "none");
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
    expect(JSON.stringify(log.mock.calls)).not.toContain("acct_1");
    log.mockRestore();
  });

  it.each([...PLATFORM_SETUP_CODES])(
    "maps %s to 'Stripe needs the platform setup finished' (payouts.platformSetup), logging the code",
    async (code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      client.v2.core.accounts.create.mockRejectedValueOnce(
        new StripeError(
          "Please review the responsibilities at https://dashboard.stripe.com/…",
          code,
        ),
      );
      await expect(driver.createAccount(newAccount)).rejects.toMatchObject({
        code: "internal",
        fields: { form: "payouts.platformSetup" },
      });
      expect(log).toHaveBeenCalledWith("stripe_error", "StripeInvalidRequestError", code);
      expect(JSON.stringify(log.mock.calls)).not.toContain("dashboard.stripe.com");
      // Nothing was made, so there's nothing for support to find.
      expect(log).not.toHaveBeenCalledWith("stripe_account_unrecorded", expect.anything());
      expect(client.accounts.update).not.toHaveBeenCalled();
      log.mockRestore();
    },
  );

  it("knows the platform-setup codes from Stripe's Accounts v2 docs", () => {
    expect([...PLATFORM_SETUP_CODES].sort()).toEqual([
      "account_create_activation_required",
      "account_creation_liability_unacknowledged",
      "accounts_v2_access_blocked",
      "capability_not_available_in_country",
      "connect_profile_not_submitted",
      "cross_border_connected_account_creation_not_allowed",
    ]);
  });
});
