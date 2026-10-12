import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe's webhook (ADR 0020; D96 duplicate protection): only correctly signed events in the key's mode are taken;
// unhandled types are acknowledged and stored nowhere; each event is recorded once in the account's region and the
// object is read from Stripe again; unknown accounts get 404 and failures 500, so Stripe tries again; an event for
// studio A only ever touches A's account; nothing from the payload is logged. Nothing is asked of Stripe outside
// Montréal (D113); only the delivery holding the lease finishes an event; failures that can never succeed are recorded
// and not retried; an account whose metadata names another studio is never copied. Signatures are real (stripe-node);
// Stripe's API and the database are faked.
vi.mock("server-only", () => ({}));
// Built at run time so secret scanners never see a signing-secret-shaped literal.
const SECRET = ["whsec", "testsecret".repeat(3)].join("_");
const OTHER_SECRET = ["whsec", "someoneelse".repeat(3)].join("_");
const { systemRpc, provider } = vi.hoisted(() => ({
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
vi.mock("@/lib/supabase/service", () => ({ payoutWriteRpc: vi.fn(), payoutSystemRpc: systemRpc }));
vi.mock("@/lib/stripe", async (original) => ({
  ...(await original<typeof import("@/lib/stripe")>()),
  payments: () => provider,
  webhookSecrets: () => [SECRET],
}));
vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: (region: string) =>
    region === "ca" ? { region, url: "http://127.0.0.1:54321", publishableKey: "pk" } : null,
}));

const { signStripeBody } = await import("@/lib/stripe");

const STUDIO_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const account = (id: string, over: Record<string, unknown> = {}) => ({
  id,
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
  metadata: { daybell_studio_id: STUDIO_A, daybell_region: "ca" },
  ...over,
});

let n = 0;
const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: `evt_test${++n}`,
  object: "event",
  type,
  account: "acct_A1",
  livemode: false,
  created: 1_760_000_000,
  // Payloads can hold personal data: none of it may reach a log or the database.
  data: {
    object: type.startsWith("payout.")
      ? { id: "po_A1", description: "Maya Johnson" }
      : { id: "acct_A1", email: "parent@example.test" },
  },
  ...over,
});

function post(body: string, signature: string | null = signStripeBody(body, SECRET)) {
  return new Request("http://localhost/api/v1/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...(signature ? { "stripe-signature": signature } : {}),
    },
    body,
  });
}

const send = async (req: Request) => (await import("./route")).POST(req);
const rpcNames = () => systemRpc.mock.calls.map((c) => c[1]);

const LEASE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const claim = (over: Record<string, unknown> = {}) => ({
  data: {
    inbox_id: 7,
    studio_id: STUDIO_A,
    processed: false,
    claimed: true,
    lease: LEASE,
    ...over,
  },
  error: null,
});

/** The database: the inbox claims, finishing succeeds for the lease holder, syncs return the studio. */
const database =
  (over: Record<string, unknown> = {}) =>
  async (_region: string, fn: string) =>
    fn in over
      ? over[fn]
      : fn === "record_stripe_event"
        ? claim()
        : fn === "finish_stripe_event"
          ? { data: true, error: null }
          : { data: STUDIO_A, error: null };
const ISO = expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/);

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["error", "warn", "info", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  provider.retrieveAccount.mockImplementation(async (id: string) => account(id));
  systemRpc.mockImplementation(database());
});
afterEach(() => {
  vi.unstubAllEnvs();
  // Fixed names and the event type only: never the payload, ids, names or emails.
  const logged = JSON.stringify(logs.flatMap((l) => l.mock.calls));
  for (const secret of ["acct_", "po_", "evt_", "Maya", "parent@example.test", "whsec_"])
    expect(logged).not.toContain(secret);
  for (const l of logs) l.mockRestore();
  vi.clearAllMocks();
});

describe("POST /webhooks/stripe: who may call", () => {
  it("refuses a missing or wrong signature with 400, writing nothing and asking Stripe nothing", async () => {
    const body = JSON.stringify(event("account.updated"));
    expect((await send(post(body, null))).status).toBe(400);
    expect((await send(post(body, signStripeBody(body, OTHER_SECRET)))).status).toBe(400);
    // A signed body changed afterwards.
    const signature = signStripeBody(body, SECRET);
    expect((await send(post(body.replace("acct_A1", "acct_B1"), signature))).status).toBe(400);
    expect(systemRpc).not.toHaveBeenCalled();
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
  });

  it("refuses an event in the other mode (live vs test)", async () => {
    const res = await send(post(JSON.stringify(event("account.updated", { livemode: true }))));
    expect(res.status).toBe(400);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("refuses a body over 512 KB before checking it", async () => {
    const big = JSON.stringify({ ...event("account.updated"), pad: "x".repeat(600 * 1024) });
    expect((await send(post(big))).status).toBe(400);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("acknowledges unhandled types and platform events, storing nothing", async () => {
    for (const e of [event("charge.succeeded"), event("payout.paid", { account: undefined })]) {
      const res = await send(post(JSON.stringify(e)));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: true });
    }
    expect(systemRpc).not.toHaveBeenCalled();
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/stripe: processing", () => {
  it("records account.updated once, reads the account from Stripe again and syncs that account only", async () => {
    const e = event("account.updated");
    const res = await send(post(JSON.stringify(e)));
    expect(res.status).toBe(200);
    expect(provider.retrieveAccount).toHaveBeenCalledWith("acct_A1");
    expect(systemRpc).toHaveBeenCalledWith("ca", "record_stripe_event", {
      p_event_id: e.id,
      p_type: "account.updated",
      p_stripe_account_id: "acct_A1",
      p_livemode: false,
      p_created: new Date(1_760_000_000_000).toISOString(),
    });
    expect(systemRpc).toHaveBeenCalledWith("ca", "sync_payout_account", {
      p_stripe_account_id: "acct_A1",
      p_facts: expect.objectContaining({ charges_enabled: true }),
      p_schedule: expect.objectContaining({ payout_interval: "weekly" }),
      p_status: "active",
      p_fetched_at: ISO,
    });
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: null,
      p_permanent: false,
    });
    // Nothing from the payload is stored: only ids, the type, the mode and the time.
    expect(JSON.stringify(systemRpc.mock.calls)).not.toContain("parent@example.test");
  });

  it("copies a paid payout as Stripe has it now, on the event's own account", async () => {
    provider.retrievePayout.mockResolvedValue({
      id: "po_A1",
      amount: 12345,
      currency: "cad",
      status: "paid",
      method: "standard",
      automatic: true,
      arrival_date: 1_760_054_400,
      failure_code: null,
      created: 1_760_000_000,
    });
    expect((await send(post(JSON.stringify(event("payout.paid"))))).status).toBe(200);
    expect(provider.retrievePayout).toHaveBeenCalledWith("acct_A1", "po_A1");
    expect(systemRpc).toHaveBeenCalledWith("ca", "sync_payout", {
      p_stripe_account_id: "acct_A1",
      p_payout: {
        stripe_payout_id: "po_A1",
        amount_cents: 12345,
        currency: "CAD",
        status: "paid",
        method: "standard",
        automatic: true,
        arrival_date: "2025-10-10",
        failure_code: null,
        stripe_created_at: new Date(1_760_000_000_000).toISOString(),
      },
      p_fetched_at: ISO,
    });
    expect(JSON.stringify(systemRpc.mock.calls)).not.toContain("Maya");
  });

  it("processes a duplicate delivery once: an already processed event is acknowledged untouched", async () => {
    systemRpc.mockImplementation(
      database({ record_stripe_event: claim({ processed: true, claimed: false, lease: null }) }),
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(200);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });

  it("answers 409 while another delivery holds the event, so Stripe tries again", async () => {
    systemRpc.mockImplementation(
      database({ record_stripe_event: claim({ claimed: false, lease: null }) }),
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(409);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });

  it("answers 404 for an account Daybell doesn't know (yet), so Stripe tries again", async () => {
    systemRpc.mockImplementation(async () => ({ data: null, error: null }));
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(404);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });

  it("records a failure's code and answers 500, so Stripe tries again", async () => {
    systemRpc.mockImplementation(
      database({ sync_payout_account: { data: null, error: { code: "08006", message: "x" } } }),
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(500);
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: "sync_failed",
      p_permanent: false,
    });
  });

  it("answers 500 when Stripe can't be reached, before recording anything", async () => {
    const { ApiError } = await import("@daybell/api");
    provider.retrieveAccount.mockRejectedValue(new ApiError("internal", "Stripe"));
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(500);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("routes by the region Daybell wrote in the account's metadata, Canada otherwise (Claude's call Q11)", async () => {
    provider.retrieveAccount.mockImplementation(async (id: string) =>
      account(id, { metadata: { daybell_region: "us" } }),
    );
    await send(post(JSON.stringify(event("account.updated"))));
    // US isn't a payout region in Phase 1, so only the Canadian database is ever asked.
    expect(new Set(systemRpc.mock.calls.map((c) => c[0]))).toEqual(new Set(["ca"]));
  });

  it("refuses ids that aren't Stripe's", async () => {
    expect(
      (await send(post(JSON.stringify(event("account.updated", { account: "acct-1; drop" })))))
        .status,
    ).toBe(400);
    const odd = event("payout.paid");
    odd.data.object.id = "tr_123";
    expect((await send(post(JSON.stringify(odd)))).status).toBe(400);
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("records Stripe being unreachable for a payout as a failure Stripe retries (500)", async () => {
    const { ApiError } = await import("@daybell/api");
    provider.retrievePayout.mockRejectedValue(new ApiError("internal", "Stripe"));
    expect((await send(post(JSON.stringify(event("payout.paid"))))).status).toBe(500);
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: "stripe_unavailable",
      p_permanent: false,
    });
  });
});

describe("POST /webhooks/stripe: region (D113; security review M1)", () => {
  it("refuses outside Montréal before anything is asked of Stripe or written", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const res = await send(post(JSON.stringify(event("account.updated"))));
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("region_unavailable");
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
    expect(provider.retrievePayout).not.toHaveBeenCalled();
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("goes ahead in Montréal", async () => {
    vi.stubEnv("VERCEL_REGION", "yul1");
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(200);
    expect(provider.retrieveAccount).toHaveBeenCalledTimes(1);
  });
});

describe("POST /webhooks/stripe: the lease (security review N2)", () => {
  it("answers 409 when the lease was taken over meanwhile, so the event is finished by the other delivery", async () => {
    systemRpc.mockImplementation(database({ finish_stripe_event: { data: false, error: null } }));
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(409);
  });

  it("never processes a claim without a lease", async () => {
    systemRpc.mockImplementation(database({ record_stripe_event: claim({ lease: null }) }));
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(409);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });
});

describe("POST /webhooks/stripe: failures that can never succeed (security review N6)", () => {
  it.each([
    ["payout_currency", "23514"],
    ["payout_mismatch", "22023"],
  ])("records %s as processed and answers 200, with an alert line", async (code, pg) => {
    provider.retrievePayout.mockResolvedValue({
      id: "po_A1",
      amount: 100,
      currency: "usd",
      status: "paid",
      method: "standard",
      automatic: true,
      arrival_date: 1_760_054_400,
      failure_code: null,
      created: 1_760_000_000,
    });
    systemRpc.mockImplementation(
      database({ sync_payout: { data: null, error: { code: pg, message: code } } }),
    );
    expect((await send(post(JSON.stringify(event("payout.paid"))))).status).toBe(200);
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: code,
      p_permanent: true,
    });
    expect(console.error).toHaveBeenCalledWith(
      "stripe_webhook_permanent_failure",
      "payout.paid",
      code,
    );
  });

  it("records an object Daybell can't read (unexpected_object) as processed, e.g. monthly with no day", async () => {
    provider.retrieveAccount.mockImplementation(async (id: string) =>
      account(id, { settings: { payouts: { schedule: { interval: "monthly", delay_days: 2 } } } }),
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(200);
    expect(rpcNames()).not.toContain("sync_payout_account");
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: "unexpected_object",
      p_permanent: true,
    });
  });
});

describe("POST /webhooks/stripe: studio backstop (security review N3)", () => {
  it("never copies an account whose metadata names another studio than the database's", async () => {
    for (const metadata of [
      { daybell_studio_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", daybell_region: "ca" },
      {},
    ]) {
      provider.retrieveAccount.mockImplementation(async (id: string) => account(id, { metadata }));
      expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(200);
      expect(rpcNames()).not.toContain("sync_payout_account");
      expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
        p_inbox_id: 7,
        p_lease: LEASE,
        p_error_code: "studio_mismatch",
        p_permanent: true,
      });
      expect(console.error).toHaveBeenCalledWith(
        "stripe_webhook_studio_mismatch",
        "account.updated",
      );
      systemRpc.mockClear();
    }
    expect(provider.retrievePayout).not.toHaveBeenCalled();
  });
});

describe("POST /webhooks/stripe: Accounts v2 thin events (ADR 0020 amendment)", () => {
  // A thin event carries ids, the type and the time only; it may hold no personal data, but a test payload with some
  // proves none of it would reach a log or the database.
  const thin = (type: string, over: Record<string, unknown> = {}) => ({
    id: `evt_test_65R${++n}`,
    object: "v2.core.event",
    type,
    livemode: false,
    created: "2026-10-12T17:00:00.123Z",
    related_object: { id: "acct_A1", type: "v2.core.account", url: "/v2/core/accounts/acct_A1" },
    reason: { type: "request", request: { id: "req_1", idempotency_key: "Maya Johnson" } },
    ...over,
  });

  it.each([
    "v2.core.account.updated",
    "v2.core.account[requirements].updated",
    "v2.core.account[configuration.merchant].updated",
    "v2.core.account[configuration.merchant].capability_status_updated",
    "v2.core.account[configuration.recipient].updated",
    "v2.core.account[configuration.recipient].capability_status_updated",
  ])("records %s once, reads the account again through v1 and syncs it", async (type) => {
    const e = thin(type);
    const res = await send(post(JSON.stringify(e)));
    expect(res.status).toBe(200);
    expect(provider.retrieveAccount).toHaveBeenCalledWith("acct_A1");
    expect(systemRpc).toHaveBeenCalledWith("ca", "record_stripe_event", {
      p_event_id: e.id,
      p_type: type,
      p_stripe_account_id: "acct_A1",
      p_livemode: false,
      p_created: "2026-10-12T17:00:00.123Z",
    });
    expect(systemRpc).toHaveBeenCalledWith("ca", "sync_payout_account", {
      p_stripe_account_id: "acct_A1",
      p_facts: expect.objectContaining({ charges_enabled: true }),
      p_schedule: expect.objectContaining({ payout_interval: "weekly" }),
      p_status: "active",
      p_fetched_at: ISO,
    });
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_lease: LEASE,
      p_error_code: null,
      p_permanent: false,
    });
    expect(provider.retrievePayout).not.toHaveBeenCalled();
    expect(JSON.stringify(systemRpc.mock.calls)).not.toContain("Maya");
  });

  it("acknowledges other v2 events and events about other objects, storing nothing and asking Stripe nothing", async () => {
    for (const e of [
      thin("v2.core.account_person.updated"),
      thin("v2.core.account[identity].updated"),
      thin("v2.core.account.updated", { related_object: null }),
      thin("v2.core.account.updated", {
        related_object: { id: "acct_A1", type: "v2.core.account_person", url: "/x" },
      }),
    ]) {
      const res = await send(post(JSON.stringify(e)));
      expect(res.status).toBe(200);
    }
    expect(systemRpc).not.toHaveBeenCalled();
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
  });

  it("checks the signature, the mode, the ids and the time like snapshot events", async () => {
    const body = JSON.stringify(thin("v2.core.account.updated"));
    expect((await send(post(body, signStripeBody(body, OTHER_SECRET)))).status).toBe(400);
    expect(
      (await send(post(JSON.stringify(thin("v2.core.account.updated", { livemode: true })))))
        .status,
    ).toBe(400);
    expect(
      (await send(post(JSON.stringify(thin("v2.core.account.updated", { livemode: "false" })))))
        .status,
    ).toBe(400);
    for (const over of [
      { related_object: { id: "acct-1; drop", type: "v2.core.account", url: "/x" } },
      { related_object: { id: 7, type: "v2.core.account", url: "/x" } },
      { id: "evt_test-1" },
      { id: 7 },
      { created: "yesterday" },
      { created: 1_760_000_000 },
    ]) {
      const res = await send(post(JSON.stringify(thin("v2.core.account.updated", over))));
      expect(res.status).toBe(400);
    }
    expect(systemRpc).not.toHaveBeenCalled();
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
  });

  it("refuses outside Montréal before anything is asked of Stripe or written (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const res = await send(post(JSON.stringify(thin("v2.core.account[requirements].updated"))));
    expect(res.status).toBe(422);
    expect(provider.retrieveAccount).not.toHaveBeenCalled();
    expect(systemRpc).not.toHaveBeenCalled();
  });

  it("answers 404 for an account Daybell doesn't know yet, and 200 to a duplicate, like snapshot events", async () => {
    systemRpc.mockImplementation(async () => ({ data: null, error: null }));
    expect((await send(post(JSON.stringify(thin("v2.core.account.updated"))))).status).toBe(404);
    systemRpc.mockImplementation(
      database({ record_stripe_event: claim({ processed: true, claimed: false, lease: null }) }),
    );
    systemRpc.mockClear();
    expect((await send(post(JSON.stringify(thin("v2.core.account.updated"))))).status).toBe(200);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });
});
