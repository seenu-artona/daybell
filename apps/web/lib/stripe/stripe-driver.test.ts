import { afterEach, describe, expect, it, vi } from "vitest";

// The real driver's calls (ADR 0020 and its amendment), with stripe-node replaced: accounts are created with Accounts
// v2 (dashboard express, Daybell collecting fees and carrying losses: Seenu, Q1 and Q2), country and currency only
// (Q4), the pinned API version, the v2 idempotency key, v2 onboarding links, and the v1 endpoints (with the v2 account
// id) for the schedule, reads, payouts and login links. The create is the create only: the schedule is a separate step
// (security review 1). Stripe errors are logged by stage, class, raw type and code only, and come back typed with the
// stage and whether Stripe refused (code review S1); codes that mean Daybell's platform setup isn't finished get their
// own form code.
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
  // Like stripe-node's: `type` is the class name, `rawType` and `code` come from Stripe's answer.
  class StripeError extends Error {
    type: string;
    code: string | undefined;
    rawType: string | undefined;
    constructor(
      message: string,
      code?: string,
      { type = "StripeInvalidRequestError", rawType }: { type?: string; rawType?: string } = {},
    ) {
      super(message);
      this.code = code;
      this.type = type;
      this.rawType = rawType;
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
const { StripeCallError } = await import("./errors");
const { default: Stripe } = await import("stripe");
const StripeError = (
  Stripe as unknown as {
    errors: {
      StripeError: new (
        message: string,
        code?: string,
        options?: { type?: string; rawType?: string },
      ) => Error;
    };
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
    // The id only: nothing else happens in the same step (security review 1).
    expect(await driver.createAccount(newAccount)).toEqual({ id: "acct_1" });
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
    // The schedule is not part of the create (security review 1).
    expect(client.accounts.update).not.toHaveBeenCalled();
    expect(client.accounts.retrieve).not.toHaveBeenCalled();
  });

  it("creates Canadian accounts only (code review N4; US payouts not decided, Seenu Q3)", async () => {
    await expect(driver.createAccount({ ...newAccount, country: "US" })).rejects.toMatchObject({
      code: "region_unavailable",
    });
    expect(client.v2.core.accounts.create).not.toHaveBeenCalled();
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

  it("uses v1 with the v2 account id for schedules (marking them as set by Daybell), reads, payouts and login links", async () => {
    const marked = { daybell_schedule_set: "true" };
    await driver.updatePayoutSchedule("acct_1", { interval: "weekly", weeklyAnchor: "monday" });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "monday" } } },
      metadata: marked,
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "monthly", monthlyAnchor: 31 });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "monthly", monthly_anchor: 31 } } },
      metadata: marked,
    });
    await driver.updatePayoutSchedule("acct_1", { interval: "daily" });
    expect(client.accounts.update).toHaveBeenLastCalledWith("acct_1", {
      settings: { payouts: { schedule: { interval: "daily" } } },
      metadata: marked,
    });
    await driver.retrieveAccount("acct_1");
    expect(client.accounts.retrieve).toHaveBeenCalledWith("acct_1");
    await driver.retrievePayout("acct_1", "po_1");
    expect(client.payouts.retrieve).toHaveBeenCalledWith("po_1", {}, { stripeContext: "acct_1" });
    expect(await driver.createLoginLink("acct_1")).toEqual({ url: "https://x" });
    expect(client.accounts.createLoginLink).toHaveBeenCalledWith("acct_1");
  });

  it("turns Stripe's errors into an internal error, logging the stage, class, raw type and code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    client.accounts.retrieve.mockRejectedValueOnce(
      new StripeError("No such account: acct_1 for jane@example.test", "resource_missing"),
    );
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({
      code: "internal",
      fields: undefined,
      stage: "other",
      outcome: "refused",
    });
    expect(log).toHaveBeenCalledWith(
      "stripe_error",
      "other",
      "StripeInvalidRequestError",
      "none",
      "resource_missing",
    );
    client.accounts.retrieve.mockRejectedValueOnce(new StripeError("no code"));
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenLastCalledWith(
      "stripe_error",
      "other",
      "StripeInvalidRequestError",
      "none",
      "none",
    );
    // A code or raw type that isn't one of Stripe's identifiers is never logged as given.
    client.accounts.retrieve.mockRejectedValueOnce(
      new StripeError("x", "jane@example.test", { rawType: "Jane Doe" }),
    );
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({ code: "internal" });
    expect(log).toHaveBeenLastCalledWith(
      "stripe_error",
      "other",
      "StripeInvalidRequestError",
      "other",
      "other",
    );
    client.accounts.retrieve.mockRejectedValueOnce(new Error("socket"));
    await expect(driver.retrieveAccount("acct_1")).rejects.toMatchObject({
      code: "internal",
      outcome: "unknown",
    });
    expect(log).toHaveBeenLastCalledWith("stripe_error", "other", "unknown", "none", "none");
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
    expect(JSON.stringify(log.mock.calls)).not.toContain("Jane");
    expect(JSON.stringify(log.mock.calls)).not.toContain("acct_1");
    log.mockRestore();
  });

  describe("typed failures (code review S1; security review 1)", () => {
    it.each([
      ["StripeInvalidRequestError", "refused"],
      ["StripeAuthenticationError", "refused"],
      ["StripePermissionError", "refused"],
      ["StripeRateLimitError", "refused"],
      ["RateLimitError", "refused"],
      // A 5xx, a lost connection or timeout, or the same key still running: an account may exist.
      ["StripeAPIError", "unknown"],
      ["StripeConnectionError", "unknown"],
      ["StripeIdempotencyError", "unknown"],
    ])("a create failing with %s is stage create, %s", async (type, outcome) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      client.v2.core.accounts.create.mockRejectedValueOnce(
        new StripeError("Request for jane@example.test failed", undefined, { type }),
      );
      const err = await driver.createAccount(newAccount).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(StripeCallError);
      expect(err).toMatchObject({ code: "internal", stage: "create", outcome, fields: undefined });
      expect(log).toHaveBeenCalledWith("stripe_error", "create", type, "none", "none");
      expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
      log.mockRestore();
    });

    it("a create that times out (not a Stripe error at all) is unknown", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      client.v2.core.accounts.create.mockRejectedValueOnce(new Error("timeout"));
      await expect(driver.createAccount(newAccount)).rejects.toMatchObject({
        stage: "create",
        outcome: "unknown",
      });
      log.mockRestore();
    });

    it("a generic create failure leaves no traces: no schedule call, no unrecorded-account alert (code review N3)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      client.v2.core.accounts.create.mockRejectedValueOnce(
        new StripeError("Internal error", undefined, { type: "StripeAPIError" }),
      );
      await expect(driver.createAccount(newAccount)).rejects.toMatchObject({ stage: "create" });
      expect(client.accounts.update).not.toHaveBeenCalled();
      expect(client.accounts.retrieve).not.toHaveBeenCalled();
      expect(log).not.toHaveBeenCalledWith("stripe_account_unrecorded", expect.anything());
      log.mockRestore();
    });

    it("a schedule failure after the create is stage schedule (the account exists)", async () => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      expect(await driver.createAccount(newAccount)).toEqual({ id: "acct_1" });
      client.accounts.update.mockRejectedValueOnce(
        new StripeError("acct_1 owner jane@example.test", "parameter_unknown"),
      );
      await expect(
        driver.updatePayoutSchedule("acct_1", { interval: "weekly", weeklyAnchor: "friday" }),
      ).rejects.toMatchObject({ code: "internal", stage: "schedule", outcome: "refused" });
      expect(log).toHaveBeenCalledWith(
        "stripe_error",
        "schedule",
        "StripeInvalidRequestError",
        "none",
        "parameter_unknown",
      );
      expect(JSON.stringify(log.mock.calls)).not.toContain("jane");
      log.mockRestore();
    });
  });

  it.each([...PLATFORM_SETUP_CODES])(
    "maps %s, as a code or as v2's raw type, to payouts.platformSetup (contact support), logging it",
    async (code) => {
      const log = vi.spyOn(console, "error").mockImplementation(() => {});
      for (const error of [
        new StripeError(
          "Please review the responsibilities at https://dashboard.stripe.com/…",
          code,
        ),
        // stripe-node's generateV2Error keeps v2's error type in rawType (security review 3).
        new StripeError("Please review https://dashboard.stripe.com/…", undefined, {
          rawType: code,
        }),
      ]) {
        client.v2.core.accounts.create.mockRejectedValueOnce(error);
        const err = await driver.createAccount(newAccount).catch((e: unknown) => e);
        expect(err).toMatchObject({
          code: "internal",
          stage: "create",
          outcome: "refused",
          fields: { form: "payouts.platformSetup" },
        });
        expect((err as Error).message).toMatch(/contact Daybell support/);
        expect((err as Error).message).not.toMatch(/try again/i);
      }
      expect(log).toHaveBeenCalledWith(
        "stripe_error",
        "create",
        "StripeInvalidRequestError",
        "none",
        code,
      );
      expect(log).toHaveBeenCalledWith(
        "stripe_error",
        "create",
        "StripeInvalidRequestError",
        code,
        "none",
      );
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
