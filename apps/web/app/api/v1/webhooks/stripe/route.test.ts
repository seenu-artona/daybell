import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe's webhook (ADR 0020; D96 duplicate protection): only correctly signed events in the key's mode are taken;
// unhandled types are acknowledged and stored nowhere; each event is recorded once in the account's region and the
// object is read from Stripe again; unknown accounts get 404 and failures 500, so Stripe tries again; an event for
// studio A only ever touches A's account; nothing from the payload is logged. Signatures are real (stripe-node);
// Stripe's API and the database are faked.
vi.mock("server-only", () => ({}));
const SECRET = "whsec_testsecretabcdefghijklmnop";
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

const claim = (over: Record<string, unknown> = {}) => ({
  data: { inbox_id: 7, studio_id: STUDIO_A, processed: false, claimed: true, ...over },
  error: null,
});

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["error", "warn", "info", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  provider.retrieveAccount.mockImplementation(async (id: string) => account(id));
  systemRpc.mockImplementation(async (_region: string, fn: string) =>
    fn === "record_stripe_event" ? claim() : { data: STUDIO_A, error: null },
  );
});
afterEach(() => {
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
    expect(
      (await send(post(body, signStripeBody(body, "whsec_someoneelsesecret12345")))).status,
    ).toBe(400);
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
    });
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_error_code: null,
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
    });
    expect(JSON.stringify(systemRpc.mock.calls)).not.toContain("Maya");
  });

  it("processes a duplicate delivery once: an already processed event is acknowledged untouched", async () => {
    systemRpc.mockImplementation(async (_r: string, fn: string) =>
      fn === "record_stripe_event"
        ? claim({ processed: true, claimed: false })
        : { data: null, error: null },
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(200);
    expect(rpcNames()).toEqual(["record_stripe_event"]);
  });

  it("answers 409 while another delivery holds the event, so Stripe tries again", async () => {
    systemRpc.mockImplementation(async (_r: string, fn: string) =>
      fn === "record_stripe_event" ? claim({ claimed: false }) : { data: null, error: null },
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
    systemRpc.mockImplementation(async (_r: string, fn: string) =>
      fn === "record_stripe_event"
        ? claim()
        : fn === "sync_payout_account"
          ? { data: null, error: { code: "23514", message: "x" } }
          : { data: null, error: null },
    );
    expect((await send(post(JSON.stringify(event("account.updated"))))).status).toBe(500);
    expect(systemRpc).toHaveBeenLastCalledWith("ca", "finish_stripe_event", {
      p_inbox_id: 7,
      p_error_code: "sync_failed",
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
});
