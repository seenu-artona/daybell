import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Payout routes (ADR 0020): who may call them and in what order (the person and their role before the body or Stripe;
// the region before Stripe), every read filtered by the caller's studio, Stripe's account made once with an
// idempotency key and only the country and Daybell's ids, return addresses from siteUrl() never the request, the
// schedule saved as Stripe answered it, and named 409s. Stripe and the database are faked; row-level security is
// covered by 015_payouts.test.sql.
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
  metadata: { daybell_studio_id: STUDIO, daybell_region: "ca" },
  ...over,
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

function signIn(role: string, rows: Record<string, unknown> = {}, region = "ca") {
  const db = fakeDatabase(rows);
  scope.mockResolvedValue({ supabase: db.supabase, studio: as(role, region), userId: "user-1" });
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
  systemRpc.mockResolvedValue({ data: STUDIO, error: null });
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

  it("creates the account once (idempotency key, country only), records it for the owner, then links to Stripe", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    signIn("owner", {});
    provider.createAccount.mockResolvedValue(
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
      idempotencyKey: `daybell-payout-account-${STUDIO}`,
    });
    expect(writeRpc).toHaveBeenCalledWith("ca", "create_payout_account", "user-1", {
      p_studio_id: STUDIO,
      p_stripe_account_id: ACCOUNT,
      p_livemode: false,
      p_facts: expect.objectContaining({ details_submitted: false, currently_due_count: 1 }),
      p_schedule: {
        payout_interval: "weekly",
        weekly_anchor: "friday",
        monthly_anchor: null,
        delay_days: 2,
      },
      p_status: "needs_info",
    });
    expect(provider.createAccountLink).toHaveBeenCalledWith({
      accountId: ACCOUNT,
      refreshUrl: "https://staging.daybell.test/app/settings/payouts?stripe=refresh",
      returnUrl: "https://staging.daybell.test/app/settings/payouts?stripe=return",
    });
    // The single-use link is never logged.
    expect(JSON.stringify(log.mock.calls)).not.toContain("connect.stripe.com");
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
    signIn("owner", {});
    provider.createAccount.mockResolvedValue(stripeAccount());
    writeRpc.mockResolvedValue({
      data: null,
      error: { code: "P0001", message: "already_connected" },
    });
    const res = await routes.onboarding();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "payouts.alreadyConnected" });
    expect(provider.createAccountLink).not.toHaveBeenCalled();
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
      });
    }
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
