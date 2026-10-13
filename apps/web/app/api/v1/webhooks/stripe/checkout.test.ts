import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe's webhook, platform branch (ADR 0023 §5.3; D96 duplicate protection): parents' checkout events have no
// connected account; nothing is asked of Stripe outside Montréal (D113); the checkout is read from Stripe again and
// the order is the one its metadata names (never the payload's); each event is recorded once; a completed checkout is
// paid, its receipt asked for, its fee recovered and settled; Stripe's fee not yet known is retried (500); a mismatch
// with the order is permanent (200, alerted); an expired checkout expires the order; a checkout that isn't Daybell's is
// acknowledged and left alone. Nothing from the payload or the parent is ever logged.
vi.mock("server-only", () => ({}));
const SECRET = ["whsec", "checkoutsecret".repeat(2)].join("_");
const { sysRpc, provider } = vi.hoisted(() => ({
  sysRpc: vi.fn(),
  provider: {
    driver: "stripe",
    livemode: false,
    retrieveCheckoutSession: vi.fn(),
    setReceiptEmail: vi.fn(),
    recoverCardFee: vi.fn(),
    retrieveAccount: vi.fn(),
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  payoutSystemRpc: vi.fn(),
  checkoutSystemRpc: sysRpc,
}));
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

const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEASE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";

let n = 0;
const event = (type: string, over: Record<string, unknown> = {}) => ({
  id: `evt_checkout${++n}`,
  object: "event",
  type,
  livemode: false,
  created: Math.floor(Date.now() / 1000) - 30,
  // Payloads hold the parent's details: none of it may reach a log or the database.
  data: {
    object: {
      id: "cs_test_A1",
      object: "checkout.session",
      customer_details: { email: "parent@example.test", name: "Priya Patel" },
    },
  },
  ...over,
});
const post = (body: unknown) => {
  const text = JSON.stringify(body);
  return new Request("http://localhost/api/v1/webhooks/stripe", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": signStripeBody(text, SECRET),
    },
    body: text,
  });
};
const send = async (req: Request) => (await import("./route")).POST(req);

const facts = (over: Record<string, unknown> = {}) => ({
  id: "cs_test_A1",
  status: "complete",
  paymentStatus: "paid",
  livemode: false,
  url: null,
  expiresAt: 0,
  currency: "cad",
  amountSubtotal: 10000,
  amountShipping: 0,
  amountTax: 0,
  amountTotal: 10000,
  orderId: ORDER,
  studioId: STUDIO,
  region: "ca",
  paymentIntentId: "pi_1",
  chargeId: "ch_1",
  transferId: "tr_1",
  destination: "acct_A1",
  applicationFeeAmount: 300,
  balanceTransaction: { id: "txn_1", feeCents: 320, currency: "cad" },
  receiptEmail: "parent@example.test",
  shipping: null,
  ...over,
});

const claim = (over: Record<string, unknown> = {}) => ({
  data: {
    inbox_id: 9,
    studio_id: STUDIO,
    order_id: ORDER,
    processed: false,
    claimed: true,
    lease: LEASE,
    ...over,
  },
  error: null,
});
const database =
  (over: Record<string, unknown> = {}) =>
  async (_region: string, fn: string) =>
    fn in over
      ? over[fn]
      : fn === "record_order_stripe_event"
        ? claim()
        : fn === "complete_order"
          ? { data: "paid", error: null }
          : fn === "settle_order_fees"
            ? { data: "settled", error: null }
            : { data: true, error: null };
const names = () => sysRpc.mock.calls.map((c) => c[1]);
const finish = () => sysRpc.mock.calls.find((c) => c[1] === "finish_stripe_event")?.[2];

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["error", "warn", "info", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  provider.retrieveCheckoutSession.mockResolvedValue(facts());
  provider.recoverCardFee.mockResolvedValue({ reversalId: "trr_1" });
  provider.setReceiptEmail.mockResolvedValue(undefined);
  sysRpc.mockImplementation(database());
});
afterEach(() => {
  vi.unstubAllEnvs();
  const logged = JSON.stringify(logs.flatMap((l) => l.mock.calls));
  for (const secret of ["parent@example.test", "Priya", "cs_test", "evt_", ORDER, "pi_", "acct_"])
    expect(logged).not.toContain(secret);
  for (const l of logs) l.mockRestore();
  vi.clearAllMocks();
});

describe("POST /webhooks/stripe: parents' checkouts (the platform's own events)", () => {
  it("asks Stripe nothing outside the payout regions' function regions (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    const res = await send(post(event("checkout.session.completed")));
    expect(res.status).toBe(422);
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
    expect(sysRpc).not.toHaveBeenCalled();
  });

  it("records the event once for the order Stripe names, pays it, recovers the fee and settles", async () => {
    const res = await send(post(event("checkout.session.completed")));
    expect(res.status).toBe(200);
    expect(provider.retrieveCheckoutSession).toHaveBeenCalledWith("cs_test_A1");
    expect(sysRpc.mock.calls[0]?.[2]).toMatchObject({
      p_type: "checkout.session.completed",
      p_order_id: ORDER,
      p_checkout_session_id: "cs_test_A1",
      p_livemode: false,
    });
    expect(names()).toEqual([
      "record_order_stripe_event",
      "complete_order",
      "settle_order_fees",
      "finish_stripe_event",
    ]);
    expect(provider.recoverCardFee).toHaveBeenCalledWith({
      transferId: "tr_1",
      amountCents: 320,
      orderId: ORDER,
    });
    expect(finish()).toEqual({
      p_inbox_id: 9,
      p_lease: LEASE,
      p_error_code: null,
      p_permanent: false,
    });
    // The payload's customer details never reach the database.
    expect(JSON.stringify(sysRpc.mock.calls)).not.toMatch(/parent@example|Priya/);
  });

  it("does nothing more for an event already processed, and 409 while another delivery holds it", async () => {
    sysRpc.mockImplementation(database({ record_order_stripe_event: claim({ processed: true }) }));
    expect((await send(post(event("checkout.session.completed")))).status).toBe(200);
    expect(names()).toEqual(["record_order_stripe_event"]);
    sysRpc.mockImplementation(
      database({ record_order_stripe_event: claim({ claimed: false, lease: null }) }),
    );
    expect((await send(post(event("checkout.session.completed")))).status).toBe(409);
  });

  it("answers 404 for an order this database doesn't hold, so Stripe tries again", async () => {
    sysRpc.mockImplementation(database({ record_order_stripe_event: { data: null, error: null } }));
    expect((await send(post(event("checkout.session.completed")))).status).toBe(404);
  });

  it("retries while Stripe's fee isn't known yet: paid now, the ledger later (500)", async () => {
    provider.retrieveCheckoutSession.mockResolvedValue(facts({ balanceTransaction: null }));
    const res = await send(post(event("checkout.session.completed")));
    expect(res.status).toBe(500);
    expect(names()).toEqual(["record_order_stripe_event", "complete_order", "finish_stripe_event"]);
    expect(finish()).toMatchObject({ p_error_code: "fee_pending", p_permanent: false });
    expect(provider.recoverCardFee).not.toHaveBeenCalled();
  });

  it("records a mismatch with the order for good, alerts by name and answers 200", async () => {
    sysRpc.mockImplementation(
      database({
        complete_order: { data: null, error: { code: "P0001", message: "checkout_mismatch" } },
      }),
    );
    const res = await send(post(event("checkout.session.completed")));
    expect(res.status).toBe(200);
    expect(finish()).toMatchObject({ p_error_code: "checkout_mismatch", p_permanent: true });
    expect(JSON.stringify(logs[0]?.mock.calls)).toContain("stripe_webhook_permanent_failure");
  });

  it("never pays an order of another studio than the checkout's own (a backstop)", async () => {
    provider.retrieveCheckoutSession.mockResolvedValue(
      facts({ studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    );
    expect((await send(post(event("checkout.session.completed")))).status).toBe(200);
    expect(names()).not.toContain("complete_order");
    expect(finish()).toMatchObject({ p_error_code: "studio_mismatch", p_permanent: true });
  });

  it("expires the order when Stripe's checkout runs out", async () => {
    provider.retrieveCheckoutSession.mockResolvedValue(
      facts({ status: "expired", paymentStatus: "unpaid", balanceTransaction: null }),
    );
    expect((await send(post(event("checkout.session.expired")))).status).toBe(200);
    expect(names()).toEqual(["record_order_stripe_event", "expire_order", "finish_stripe_event"]);
  });

  it("acknowledges a checkout that isn't Daybell's and records nothing", async () => {
    provider.retrieveCheckoutSession.mockResolvedValue(
      facts({ orderId: null, studioId: null, region: null }),
    );
    expect((await send(post(event("checkout.session.completed")))).status).toBe(200);
    expect(sysRpc).not.toHaveBeenCalled();
  });

  it("refuses a malformed checkout id before asking Stripe", async () => {
    const bad = event("checkout.session.completed", { data: { object: { id: "not a session" } } });
    expect((await send(post(bad))).status).toBe(400);
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
  });
});
