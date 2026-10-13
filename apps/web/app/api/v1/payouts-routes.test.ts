import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Payout routes (ADR 0020): who may call them and in what order (the person and their role before the body or Stripe;
// the region before Stripe), every read filtered by the caller's studio, Stripe's account made once with an
// idempotency key and only the country and Daybell's ids, return addresses from siteUrl() never the request, the
// schedule saved as Stripe answered it with the time Stripe was asked, named 409s, a per-studio budget of Stripe calls
// (429), Stripe links that must be Stripe's own, and an alert when Stripe made an account Daybell couldn't record. The
// account is recorded before Daybell's default schedule is set, as its own step (security review 1).
// Stripe and the database are faked; row-level security is covered by 015_payouts.test.sql.
vi.mock("server-only", () => ({}));
const { scope, writeRpc, systemRpc, provider } = vi.hoisted(() => ({
  scope: vi.fn(),
  writeRpc: vi.fn(),
  systemRpc: vi.fn(),
  provider: {
    driver: "stripe",
    livemode: false,
    createAccount: vi.fn(),
    retrieveAccount: vi.fn(),
    createAccountLink: vi.fn(),
    updatePayoutSchedule: vi.fn(),
    retrievePayout: vi.fn(),
    createLoginLink: vi.fn(),
  },
}));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/supabase/service", () => ({ payoutWriteRpc: writeRpc, payoutSystemRpc: systemRpc }));
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  payments: () => provider,
}));

const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const ACCOUNT = "acct_A1";
const as = (role: string, region = "ca") => ({ id: STUDIO, name: "A", slug: "a", region, role });

const stripeAccount = (over: Record<string, unknown> = {}) => ({
  id: ACCOUNT,
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  requirements: {
    currently_due: [],
    past_due: [],
    pending_verification: [],
    disabled_reason: null,
    current_deadline: null,
  },
  settings: {
    payouts: { schedule: { interval: "weekly", weekly_anchor: "friday", delay_days: 2 } },
  },
  // Daybell has set this account's schedule (security review 1).
  metadata: { daybell_studio_id: STUDIO, daybell_region: "ca", daybell_schedule_set: "true" },
  ...over,
});

/** An account as Stripe has it just after the v2 create: details needed, Stripe's own schedule, no marker. */
const newStripeAccount = () =>
  stripeAccount({
    details_submitted: false,
    charges_enabled: false,
    payouts_enabled: false,
    requirements: {
      currently_due: ["external_account"],
      past_due: ["external_account"],
      pending_verification: [],
      disabled_reason: "requirements.past_due",
      current_deadline: null,
    },
    settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } },
    metadata: { daybell_studio_id: STUDIO, daybell_region: "ca" },
  });

const accountRow = (over: Record<string, unknown> = {}) => ({
  id: "row-1",
  stripe_account_id: ACCOUNT,
  status: "active",
  details_submitted: true,
  charges_enabled: true,
  payouts_enabled: true,
  disabled_reason: null,
  currently_due_count: 0,
  past_due_count: 0,
  requirements_deadline: null,
  payout_interval: "weekly",
  weekly_anchor: "friday",
  monthly_anchor: null,
  ...over,
});

type Call = { table: string; ops: [string, unknown[]][] };

/** A stand-in for the Supabase client: each table answers with `rows[table]`; every call is recorded. */
function fakeDatabase(rows: Record<string, unknown>) {
  const calls: Call[] = [];
  const from = (table: string) => {
    const call: Call = { table, ops: [] };
    calls.push(call);
    const chain: object = new Proxy(
      {},
      {
        get: (_target, prop: string) =>
          prop === "then"
            ? (resolve: (v: unknown) => void) => resolve({ data: rows[table] ?? null, error: null })
            : (...args: unknown[]) => {
                call.ops.push([prop, args]);
                return chain;
              },
      },
    );
    return chain;
  };
  return { supabase: { from }, calls };
}

/** The owner's sign-in email, from the verified auth user (step 7c): sent to Stripe as contact_email, never logged. */
const EMAIL = "maya.owner@example.test";

function signIn(
  role: string,
  rows: Record<string, unknown> = {},
  region = "ca",
  email: string | null = EMAIL,
) {
  const db = fakeDatabase(rows);
  scope.mockResolvedValue({
    supabase: db.supabase,
    studio: as(role, region),
    userId: "user-1",
    email,
  });
  return db;
}

const request = (method: string, body?: string, headers: Record<string, string> = {}) =>
  new Request("http://localhost/api/v1/studio/payouts", {
    method,
    headers: { "content-type": "application/json", ...headers },
    body: body ?? null,
  });

type Handler = (request: Request) => Promise<Response>;
/** Route handlers take the request even when their own code doesn't read it (handle() checks its origin). */
const call = async (module: Promise<Record<string, unknown>>, method: string, req: Request) =>
  ((await module)[method] as Handler)(req);

const routes = {
  get: () => call(import("./studio/payouts/route"), "GET", request("GET")),
  onboarding: (headers: Record<string, string> = {}) =>
    call(
      import("./studio/payouts/onboarding-link/route"),
      "POST",
      request("POST", undefined, headers),
    ),
  refresh: () => call(import("./studio/payouts/refresh/route"), "POST", request("POST")),
  schedule: (body: string) =>
    call(import("./studio/payouts/schedule/route"), "PUT", request("PUT", body)),
  dashboard: () => call(import("./studio/payouts/dashboard-link/route"), "POST", request("POST")),
};

const stripeCalls = () =>
  Object.values(provider)
    .filter((v) => typeof v === "function")
    .reduce((n, fn) => n + (fn as ReturnType<typeof vi.fn>).mock.calls.length, 0);

beforeEach(() => {
  vi.stubEnv("SITE_URL", "https://staging.daybell.test");
  writeRpc.mockResolvedValue({ data: "row-1", error: null });
  systemRpc.mockImplementation(async (_region: string, fn: string) =>
    fn === "take_stripe_call" ? { data: true, error: null } : { data: STUDIO, error: null },
  );
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
  scope.mockReset();
});

describe("GET /studio/payouts", () => {
  it("refuses photographers and staff before reading anything (Seenu, answer 1)", async () => {
    for (const role of ["photographer", "staff"]) {
      const db = signIn(role, { payout_accounts: accountRow() });
      const res = await routes.get();
      expect(res.status).toBe(403);
      expect(db.calls).toEqual([]);
    }
  });

  it("tells US studios payouts aren't available yet (Seenu, Q3)", async () => {
    const db = signIn("owner", {}, "us");
    const res = await routes.get();
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("region_unavailable");
    expect(db.calls).toEqual([]);
  });

  it("shows owners and admins the studio's own account, payouts and fees, without calling Stripe", async () => {
    for (const role of ["owner", "admin"]) {
      const db = signIn(role, {
        payout_accounts: accountRow({
          payout_interval: "monthly",
          weekly_anchor: null,
          monthly_anchor: 1,
        }),
        payouts: [
          {
            id: "p1",
            amount_cents: "12345",
            currency: "CAD",
            status: "paid",
            method: "standard",
            automatic: true,
            arrival_date: "2026-10-09",
            failure_code: null,
          },
        ],
      });
      const res = await routes.get();
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toBe("private, no-store");
      const body = await res.json();
      expect(body.canManage).toBe(role === "owner");
      expect(body.account).toMatchObject({
        status: "active",
        schedule: { interval: "monthly", weeklyAnchor: null, monthlyAnchor: 1 },
      });
      expect(body.nextPayoutDate).toMatch(/^\d{4}-\d{2}-01$/);
      expect(body.payouts).toEqual([
        {
          id: "p1",
          amount: { cents: 12345, currency: "CAD" },
          status: "paid",
          method: "standard",
          automatic: true,
          arrivalDate: "2026-10-09",
          failureCode: null,
        },
      ]);
      expect(body.fees).toMatchObject({
        daybellBasisPoints: 300,
        activeAccount: { currency: "CAD" },
      });
      for (const c of db.calls) expect(c.ops).toContainEqual(["eq", ["studio_id", STUDIO]]);
      expect(JSON.stringify(body)).not.toContain(ACCOUNT);
    }
    expect(stripeCalls()).toBe(0);
  });

  it("says Not started (no account) with no next payout before setup", async () => {
    signIn("owner", {});
    const body = await (await routes.get()).json();
    expect(body).toMatchObject({ account: null, nextPayoutDate: null, payouts: [] });
  });
});

describe("POST /studio/payouts/onboarding-link", () => {
  it("is the owner's alone: admins get 403 and Stripe is never called", async () => {
    for (const role of ["admin", "photographer", "staff"]) {
      signIn(role);
      expect((await routes.onboarding()).status).toBe(403);
    }
    expect(stripeCalls()).toBe(0);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("refuses US studios before Stripe", async () => {
    signIn("owner", {}, "us");
    expect((await routes.onboarding()).status).toBe(422);
    expect(stripeCalls()).toBe(0);
  });

  it("creates the account once (the v2b idempotency key, country and the owner's sign-in email), records it for the owner, then sets the default schedule and links to Stripe", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    provider.createAccount.mockResolvedValue({ id: ACCOUNT });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    provider.updatePayoutSchedule.mockResolvedValue(
      stripeAccount({
        ...newStripeAccount(),
        metadata: { daybell_studio_id: STUDIO, daybell_region: "ca", daybell_schedule_set: "true" },
        settings: {
          payouts: { schedule: { interval: "weekly", weekly_anchor: "friday", delay_days: 2 } },
        },
      }),
    );
    provider.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/setup/e/acct_A1/secret",
      expiresAt: 1_800_000_000,
    });
    // A forged host must never become the return address.
    const res = await routes.onboarding({
      host: "evil.example",
      "x-forwarded-host": "evil.example",
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      url: "https://connect.stripe.com/setup/e/acct_A1/secret",
      expiresAt: new Date(1_800_000_000_000).toISOString(),
    });
    expect(provider.createAccount).toHaveBeenCalledWith({
      studioId: STUDIO,
      region: "ca",
      country: "CA",
      // From the verified auth user, never the request (step 7c).
      contactEmail: EMAIL,
      // A new key for the new body (step 7c; ADR 0020 section 16): the studio id only, never the email.
      idempotencyKey: `daybell-payout-account-v2b-${STUDIO}`,
    });
    // Read back through v1 and recorded as Stripe has it, before anything else is asked of Stripe.
    expect(provider.retrieveAccount).toHaveBeenCalledWith(ACCOUNT);
    expect(writeRpc).toHaveBeenCalledWith("ca", "create_payout_account", "user-1", {
      p_studio_id: STUDIO,
      p_stripe_account_id: ACCOUNT,
      p_livemode: false,
      p_facts: expect.objectContaining({ details_submitted: false, currently_due_count: 1 }),
      p_schedule: {
        payout_interval: "daily",
        weekly_anchor: null,
        monthly_anchor: null,
        delay_days: 2,
      },
      p_status: "needs_info",
      p_fetched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    // Then the default schedule (weekly on Friday; D56, Q6), as its own step, and its answer saved.
    expect(provider.updatePayoutSchedule).toHaveBeenCalledWith(ACCOUNT, {
      interval: "weekly",
      weeklyAnchor: "friday",
    });
    expect(writeRpc.mock.invocationCallOrder[0]).toBeLessThan(
      provider.updatePayoutSchedule.mock.invocationCallOrder[0] ?? 0,
    );
    expect(systemRpc).toHaveBeenCalledWith("ca", "sync_payout_account", {
      p_stripe_account_id: ACCOUNT,
      p_facts: expect.objectContaining({ details_submitted: false }),
      p_schedule: expect.objectContaining({ payout_interval: "weekly", weekly_anchor: "friday" }),
      p_status: "needs_info",
      p_fetched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(provider.createAccountLink).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      refreshUrl: "https://staging.daybell.test/app/settings/payouts?stripe=refresh",
      returnUrl: "https://staging.daybell.test/app/settings/payouts?stripe=return",
    });
    // The single-use link is never logged, and nothing went wrong.
    expect(JSON.stringify(log.mock.calls)).not.toContain("connect.stripe.com");
    expect(log).not.toHaveBeenCalledWith("stripe_account_unrecorded", expect.anything());
    log.mockRestore();
  });

  it("never takes the email from the request, and never logs it (step 7c)", async () => {
    const spies = (["error", "warn", "log", "info", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
    signIn("owner", {});
    provider.createAccount.mockResolvedValue({ id: ACCOUNT });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    // Every later step fails, so every log line on the way is written.
    writeRpc.mockRejectedValue(new Error("db down"));
    const res = await call(
      import("./studio/payouts/onboarding-link/route"),
      "POST",
      request(
        "POST",
        JSON.stringify({ email: "forged@example.test", contactEmail: "forged@example.test" }),
      ),
    );
    expect(res.status).toBe(500);
    expect(provider.createAccount).toHaveBeenCalledWith(
      // The key holds the studio id only, never the email.
      expect.objectContaining({
        contactEmail: EMAIL,
        idempotencyKey: `daybell-payout-account-v2b-${STUDIO}`,
      }),
    );
    expect(spies[0]).toHaveBeenCalledWith("stripe_account_unrecorded", STUDIO);
    // An unknown create outcome logs too: still never the email.
    provider.createAccount.mockRejectedValueOnce(new Error(`failed for ${EMAIL}`));
    expect((await routes.onboarding()).status).toBe(500);
    expect(spies[0]).toHaveBeenCalledWith("stripe_account_create_unknown", STUDIO);
    const logged = JSON.stringify(spies.map((s) => s.mock.calls));
    expect(logged).not.toContain("maya");
    expect(logged).not.toContain("forged");
    expect(await res.text()).not.toContain("maya");
    for (const s of spies) s.mockRestore();
  });

  it("refuses with 409 payouts.noContactEmail, before Stripe, when the sign-in has no email (step 7c)", async () => {
    for (const email of [null, ""]) {
      signIn("owner", {}, "ca", email);
      const res = await routes.onboarding();
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatchObject({
        code: "conflict",
        fields: { form: "payouts.noContactEmail" },
      });
    }
    expect(stripeCalls()).toBe(0);
    expect(writeRpc).not.toHaveBeenCalled();
  });

  it("records the account even when the schedule fails, and the next POST never creates again (security review 1)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { StripeCallError } = await import("@/lib/stripe");
    // The database as the routes see it: create_payout_account fills it in.
    const rows: Record<string, unknown> = {};
    signIn("owner", rows);
    writeRpc.mockImplementation(async (_region: string, fn: string, _actor: string, args) => {
      if (fn === "create_payout_account")
        rows.payout_accounts = accountRow({
          stripe_account_id: (args as { p_stripe_account_id: string }).p_stripe_account_id,
          status: "needs_info",
        });
      return { data: "row-1", error: null };
    });
    provider.createAccount.mockResolvedValue({ id: ACCOUNT });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    provider.updatePayoutSchedule.mockRejectedValue(
      new StripeCallError("We couldn't reach Stripe. Please try again.", "schedule", "refused"),
    );
    provider.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/x",
      expiresAt: 1,
    });
    // The owner still gets their link: the schedule is set later by refresh or the webhook.
    expect((await routes.onboarding()).status).toBe(200);
    expect(writeRpc).toHaveBeenCalledWith(
      "ca",
      "create_payout_account",
      "user-1",
      expect.objectContaining({ p_stripe_account_id: ACCOUNT }),
    );
    expect(log).toHaveBeenCalledWith("stripe_schedule_default_failed");
    expect(log).not.toHaveBeenCalledWith("stripe_account_unrecorded", expect.anything());
    expect(systemRpc.mock.calls.map((c) => c[1])).not.toContain("sync_payout_account");
    // A second click continues with the recorded account.
    expect((await routes.onboarding()).status).toBe(200);
    expect(provider.createAccount).toHaveBeenCalledTimes(1);
    expect(provider.createAccountLink).toHaveBeenLastCalledWith(
      expect.objectContaining({ accountId: ACCOUNT }),
    );
    log.mockRestore();
  });

  it("continues with the existing account without creating another", async () => {
    signIn("owner", { payout_accounts: accountRow({ status: "needs_info" }) });
    provider.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com/x",
      expiresAt: 1,
    });
    expect((await routes.onboarding()).status).toBe(200);
    expect(provider.createAccount).not.toHaveBeenCalled();
    expect(writeRpc).not.toHaveBeenCalled();
    expect(provider.createAccountLink).toHaveBeenCalledWith(
      expect.objectContaining({ accountId: ACCOUNT }),
    );
  });

  it("answers 409 payouts.alreadyConnected when the studio got another account meanwhile", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    provider.createAccount.mockResolvedValue({ id: ACCOUNT });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    writeRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "already_connected" },
    });
    const res = await routes.onboarding();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "payouts.alreadyConnected" });
    expect(provider.createAccountLink).not.toHaveBeenCalled();
    expect(provider.updatePayoutSchedule).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("POST /studio/payouts/onboarding-link: Stripe's platform setup (ADR 0020 amendment)", () => {
  it("tells the owner Daybell's platform setup isn't finished, recording nothing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    const { StripeCallError } = await import("@/lib/stripe");
    provider.createAccount.mockRejectedValue(
      new StripeCallError("Daybell's Stripe platform setup isn't finished.", "create", "refused", {
        form: "payouts.platformSetup",
      }),
    );
    const res = await routes.onboarding();
    expect(res.status).toBe(500);
    expect((await res.json()).error).toMatchObject({
      code: "internal",
      fields: { form: "payouts.platformSetup" },
    });
    expect(writeRpc).not.toHaveBeenCalled();
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
    expect(provider.createAccountLink).not.toHaveBeenCalled();
    // Refused: Stripe made nothing, so there's nothing for support to find.
    expect(log).not.toHaveBeenCalledWith("stripe_account_create_unknown", expect.anything());
    log.mockRestore();
  });

  it("raises an alert with the studio id only when the create's outcome is unknown (a 5xx or timeout)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    const { StripeCallError } = await import("@/lib/stripe");
    for (const err of [
      new StripeCallError("We couldn't reach Stripe. Please try again.", "create", "unknown"),
      new Error("socket hang up"),
    ]) {
      provider.createAccount.mockRejectedValueOnce(err);
      expect((await routes.onboarding()).status).toBe(500);
    }
    expect(log.mock.calls.filter((c) => c[0] === "stripe_account_create_unknown")).toEqual([
      ["stripe_account_create_unknown", STUDIO],
      ["stripe_account_create_unknown", STUDIO],
    ]);
    expect(writeRpc).not.toHaveBeenCalled();
    log.mockRestore();
  });
});

describe("POST /studio/payouts/refresh", () => {
  it("answers 409 payouts.notConnected before setup, and 403 to photographers", async () => {
    signIn("owner", {});
    const res = await routes.refresh();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "payouts.notConnected" });
    signIn("photographer", { payout_accounts: accountRow() });
    expect((await routes.refresh()).status).toBe(403);
    expect(stripeCalls()).toBe(0);
  });

  it("reads the studio's own account from Stripe and saves its facts and status (owners and admins)", async () => {
    for (const role of ["owner", "admin"]) {
      signIn(role, { payout_accounts: accountRow({ status: "needs_info" }) });
      provider.retrieveAccount.mockResolvedValue(stripeAccount());
      expect((await routes.refresh()).status).toBe(200);
      expect(provider.retrieveAccount).toHaveBeenLastCalledWith(ACCOUNT);
      expect(systemRpc).toHaveBeenLastCalledWith("ca", "sync_payout_account", {
        p_stripe_account_id: ACCOUNT,
        p_facts: expect.objectContaining({ charges_enabled: true, payouts_enabled: true }),
        p_schedule: expect.objectContaining({ payout_interval: "weekly" }),
        p_status: "active",
        p_fetched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
      });
    }
    // Daybell already set this account's schedule: it is left alone.
    expect(provider.updatePayoutSchedule).not.toHaveBeenCalled();
  });

  it("sets Daybell's default schedule if its first try failed, and saves Stripe's answer (security review 1)", async () => {
    signIn("admin", { payout_accounts: accountRow({ status: "needs_info" }) });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    provider.updatePayoutSchedule.mockResolvedValue(
      stripeAccount({ details_submitted: false, charges_enabled: false, payouts_enabled: false }),
    );
    expect((await routes.refresh()).status).toBe(200);
    expect(provider.updatePayoutSchedule).toHaveBeenCalledWith(ACCOUNT, {
      interval: "weekly",
      weeklyAnchor: "friday",
    });
    expect(systemRpc).toHaveBeenLastCalledWith(
      "ca",
      "sync_payout_account",
      expect.objectContaining({
        p_stripe_account_id: ACCOUNT,
        p_schedule: expect.objectContaining({ payout_interval: "weekly", weekly_anchor: "friday" }),
      }),
    );
  });

  it("still saves what Stripe has when setting the default schedule fails again", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", { payout_accounts: accountRow({ status: "needs_info" }) });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    provider.updatePayoutSchedule.mockRejectedValue(new Error("stripe down"));
    expect((await routes.refresh()).status).toBe(200);
    expect(systemRpc).toHaveBeenLastCalledWith(
      "ca",
      "sync_payout_account",
      expect.objectContaining({
        p_schedule: expect.objectContaining({ payout_interval: "daily" }),
      }),
    );
    expect(log).toHaveBeenCalledWith("stripe_schedule_default_failed");
    log.mockRestore();
  });
});

describe("PUT /studio/payouts/schedule", () => {
  it("checks the role before reading the body", async () => {
    for (const role of ["admin", "photographer", "staff"]) {
      signIn(role, { payout_accounts: accountRow() });
      expect((await routes.schedule("{ not json")).status).toBe(403);
    }
    expect(stripeCalls()).toBe(0);
  });

  it("refuses a bad schedule with field keys, and 409 without an account", async () => {
    signIn("owner", { payout_accounts: accountRow() });
    const bad = await routes.schedule(
      JSON.stringify({ interval: "weekly", weeklyAnchor: "sunday" }),
    );
    expect(bad.status).toBe(400);
    expect((await bad.json()).error.fields).toEqual({ weeklyAnchor: "validation.payoutWeekday" });
    signIn("owner", {});
    expect((await routes.schedule(JSON.stringify({ interval: "daily" }))).status).toBe(409);
    expect(stripeCalls()).toBe(0);
  });

  it("changes Stripe first, then saves the schedule Stripe answered with", async () => {
    signIn("owner", { payout_accounts: accountRow() });
    provider.updatePayoutSchedule.mockResolvedValue(
      stripeAccount({
        settings: {
          payouts: { schedule: { interval: "monthly", monthly_anchor: 15, delay_days: 7 } },
        },
      }),
    );
    const res = await routes.schedule(JSON.stringify({ interval: "monthly", monthlyAnchor: 15 }));
    expect(res.status).toBe(200);
    expect(provider.updatePayoutSchedule).toHaveBeenCalledWith(ACCOUNT, {
      interval: "monthly",
      monthlyAnchor: 15,
    });
    expect(writeRpc).toHaveBeenCalledWith("ca", "set_payout_schedule", "user-1", {
      p_studio_id: STUDIO,
      p_schedule: {
        payout_interval: "monthly",
        weekly_anchor: null,
        monthly_anchor: 15,
        delay_days: 7,
      },
      p_fetched_at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
  });

  it("saves nothing when Stripe refuses", async () => {
    signIn("owner", { payout_accounts: accountRow() });
    const { ApiError } = await import("@daybell/api");
    provider.updatePayoutSchedule.mockRejectedValue(new ApiError("internal", "Stripe"));
    expect((await routes.schedule(JSON.stringify({ interval: "daily" }))).status).toBe(500);
    expect(writeRpc).not.toHaveBeenCalled();
  });
});

describe("POST /studio/payouts/dashboard-link", () => {
  it("is the owner's, once Stripe has their details", async () => {
    signIn("admin", { payout_accounts: accountRow() });
    expect((await routes.dashboard()).status).toBe(403);
    signIn("owner", { payout_accounts: accountRow({ details_submitted: false }) });
    expect((await routes.dashboard()).status).toBe(409);
    expect(provider.createLoginLink).not.toHaveBeenCalled();
    signIn("owner", { payout_accounts: accountRow() });
    provider.createLoginLink.mockResolvedValue({ url: "https://connect.stripe.com/express/x" });
    const res = await routes.dashboard();
    expect(await res.json()).toEqual({
      url: "https://connect.stripe.com/express/x",
      expiresAt: null,
    });
    expect(provider.createLoginLink).toHaveBeenCalledWith(ACCOUNT);
  });
});

describe("Stripe call budget (security review N1)", () => {
  const limited = () =>
    systemRpc.mockImplementation(async (_region: string, fn: string) =>
      fn === "take_stripe_call" ? { data: false, error: null } : { data: STUDIO, error: null },
    );

  it("answers 429 rate_limited on every route that calls Stripe once the studio's minute is used up", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    for (const [name, run] of [
      ["onboarding", () => routes.onboarding()],
      ["refresh", () => routes.refresh()],
      ["schedule", () => routes.schedule(JSON.stringify({ interval: "daily" }))],
      ["dashboard", () => routes.dashboard()],
    ] as const) {
      signIn("owner", { payout_accounts: accountRow() });
      limited();
      const res = await run();
      expect(res.status, name).toBe(429);
      expect((await res.json()).error.code).toBe("rate_limited");
    }
    expect(stripeCalls()).toBe(0);
    expect(writeRpc).not.toHaveBeenCalled();
    // Counted for the caller's own studio, 10 a minute.
    for (const c of systemRpc.mock.calls.filter((c) => c[1] === "take_stripe_call"))
      expect(c).toEqual(["ca", "take_stripe_call", { p_studio_id: STUDIO, p_limit: 10 }]);
    // A fixed name only.
    expect(JSON.stringify(warn.mock.calls)).not.toContain(STUDIO);
    warn.mockRestore();
  });

  it("isn't spent by people the route refuses, or on reads", async () => {
    signIn("admin", { payout_accounts: accountRow() });
    expect((await routes.onboarding()).status).toBe(403);
    signIn("owner", { payout_accounts: accountRow() }, "us");
    expect((await routes.refresh()).status).toBe(422);
    signIn("owner", { payout_accounts: accountRow() });
    expect((await routes.get()).status).toBe(200);
    expect(systemRpc.mock.calls.map((c) => c[1])).not.toContain("take_stripe_call");
  });
});

describe("Stripe links (security review N5)", () => {
  it("are returned only when they are Stripe's own Connect pages", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", { payout_accounts: accountRow({ status: "needs_info" }) });
    provider.createAccountLink.mockResolvedValue({
      url: "https://connect.stripe.com.evil.example/setup",
      expiresAt: 1,
    });
    const onboarding = await routes.onboarding();
    expect(onboarding.status).toBe(500);
    expect(JSON.stringify(await onboarding.json())).not.toContain("evil");
    signIn("owner", { payout_accounts: accountRow() });
    provider.createLoginLink.mockResolvedValue({ url: "http://connect.stripe.com/express/x" });
    expect((await routes.dashboard()).status).toBe(500);
    // A Stripe host is named (diagnosable if Stripe moves its pages); any other host is "other"; never the address.
    expect(errors).toHaveBeenCalledWith("stripe_link_unexpected", "stripe", "other");
    expect(errors).toHaveBeenCalledWith("stripe_link_unexpected", "stripe", "connect.stripe.com");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("evil");
    expect(JSON.stringify(errors.mock.calls)).not.toContain("/express/x");
    errors.mockRestore();
  });
});

describe("an account Stripe made but Daybell couldn't record (security review N4)", () => {
  it("is logged with the studio id only, so support can find it on Stripe by its metadata", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    provider.createAccount.mockResolvedValue({ id: ACCOUNT });
    provider.retrieveAccount.mockResolvedValue(newStripeAccount());
    writeRpc.mockResolvedValue({ data: null, error: { code: "08006", message: "connection" } });
    expect((await routes.onboarding()).status).toBe(500);
    // Reading it back failing is the same: Stripe has the account, Daybell doesn't.
    provider.retrieveAccount.mockRejectedValueOnce(new Error("stripe down"));
    expect((await routes.onboarding()).status).toBe(500);
    expect(errors.mock.calls.filter((c) => c[0] === "stripe_account_unrecorded")).toEqual([
      ["stripe_account_unrecorded", STUDIO],
      ["stripe_account_unrecorded", STUDIO],
    ]);
    expect(JSON.stringify(errors.mock.calls)).not.toContain(ACCOUNT);
    expect(provider.updatePayoutSchedule).not.toHaveBeenCalled();
    expect(provider.createAccountLink).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
