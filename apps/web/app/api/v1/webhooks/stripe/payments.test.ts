import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Stripe's webhook, the platform's payment events (ADR 0024; D96 duplicate protection, D113): refunds Stripe finished
// or failed and disputes opened on a parent's payment. Nothing is asked of Stripe outside Montréal; the payment is
// found from Stripe (the refund or dispute read again), never the payload; the order is the one Daybell wrote in the
// payment's metadata; each event is recorded once; a dispute flags the order; a refund event takes Daybell's refunds
// as far as they go; a refund made outside Daybell is a permanent, alerted problem; a payment that isn't Daybell's is
// acknowledged and left alone. Nothing from the payload or the parent is ever logged.
vi.mock("server-only", () => ({}));
const SECRET = ["whsec", "paymentsecret".repeat(2)].join("_");
const { sysRpc, provider, sync } = vi.hoisted(() => ({
  sysRpc: vi.fn(),
  sync: vi.fn(),
  provider: {
    driver: "stripe",
    livemode: false,
    retrieveRefund: vi.fn(),
    retrieveDispute: vi.fn(),
    retrievePaymentIntentIds: vi.fn(),
    retrieveAccount: vi.fn(),
  },
}));
vi.mock("@/lib/supabase/service", () => ({
  payoutSystemRpc: vi.fn(),
  checkoutSystemRpc: vi.fn(),
  orderSystemRpc: sysRpc,
}));
vi.mock("@/lib/orders/refunds", async (original) => ({
  ...(await original<typeof import("@/lib/orders/refunds")>()),
  syncStripeRefund: sync,
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
const { RefundProblem } = await import("@/lib/orders/refunds");

const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const STUDIO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const LEASE = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
const R = "aaaa0000-0000-4000-8000-000000000001";

let n = 0;
const event = (type: string, object: Record<string, unknown>) => ({
  id: `evt_payment${++n}`,
  object: "event",
  type,
  livemode: false,
  created: Math.floor(Date.now() / 1000) - 30,
  // Payloads can hold the parent's details: none of it may reach a log or the database.
  data: {
    object: { billing_details: { email: "parent@example.test", name: "Priya Patel" }, ...object },
  },
});
const refunded = () =>
  event("charge.refunded", { id: "ch_1", object: "charge", payment_intent: "pi_1" });
const refundFailed = () => event("refund.failed", { id: "re_2", object: "refund" });
const disputed = () => event("charge.dispute.created", { id: "dp_1", object: "dispute" });
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

const facts = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  status: "succeeded",
  amountCents: 1469,
  currency: "cad",
  paymentIntentId: "pi_1",
  refundId: R,
  orderId: ORDER,
  region: "ca",
  failureReason: null,
  ...over,
});
const payment = (over: Record<string, unknown> = {}) => ({
  id: "pi_1",
  orderId: ORDER,
  studioId: STUDIO,
  region: "ca",
  refunds: [
    facts("re_1"),
    facts("re_2", { status: "failed", failureReason: "expired_or_canceled_card" }),
  ],
  ...over,
});
const claim = (over: Record<string, unknown> = {}) => ({
  data: { inbox_id: 9, studio_id: STUDIO, processed: false, claimed: true, lease: LEASE, ...over },
  error: null,
});
const database =
  (over: Record<string, unknown> = {}) =>
  async (_region: string, fn: string) =>
    fn in over
      ? over[fn]
      : fn === "record_payment_stripe_event"
        ? claim()
        : { data: true, error: null };
const names = () => sysRpc.mock.calls.map((c) => c[1]);
const finish = () => sysRpc.mock.calls.find((c) => c[1] === "finish_stripe_event")?.[2];

let logs: ReturnType<typeof vi.spyOn>[] = [];
beforeEach(() => {
  logs = (["error", "warn", "info", "log"] as const).map((level) =>
    vi.spyOn(console, level).mockImplementation(() => {}),
  );
  provider.retrieveRefund.mockImplementation(async (id: string) => facts(id));
  provider.retrieveDispute.mockResolvedValue({ id: "dp_1", paymentIntentId: "pi_1" });
  provider.retrievePaymentIntentIds.mockResolvedValue(payment());
  sync.mockResolvedValue("synced");
  sysRpc.mockImplementation(database());
});
afterEach(() => {
  vi.unstubAllEnvs();
  const logged = JSON.stringify(logs.flatMap((l) => l.mock.calls));
  for (const secret of ["parent@example.test", "Priya", "evt_", ORDER, "pi_", "re_", "dp_", "ch_"])
    expect(logged).not.toContain(secret);
  for (const l of logs) l.mockRestore();
  vi.clearAllMocks();
});

describe("POST /webhooks/stripe: refunds and disputes (ADR 0024)", () => {
  it("asks Stripe nothing outside the payout regions' function regions (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    expect((await send(post(refundFailed()))).status).toBe(422);
    expect(provider.retrieveRefund).not.toHaveBeenCalled();
    expect(sysRpc).not.toHaveBeenCalled();
  });

  it("records a charge refunded once for the payment's order and takes each of its refunds as far as they go", async () => {
    const res = await send(post(refunded()));
    expect(res.status).toBe(200);
    expect(provider.retrievePaymentIntentIds).toHaveBeenCalledWith("pi_1");
    expect(sysRpc.mock.calls[0]?.[2]).toMatchObject({
      p_type: "charge.refunded",
      p_order_id: ORDER,
      p_payment_intent_id: "pi_1",
      p_livemode: false,
    });
    expect(sync.mock.calls.map((c) => c[3].id)).toEqual(["re_1", "re_2"]);
    expect(sync.mock.calls[0]?.slice(0, 3)).toEqual(["ca", provider, ORDER]);
    expect(names()).toEqual(["record_payment_stripe_event", "finish_stripe_event"]);
    expect(finish()).toEqual({
      p_inbox_id: 9,
      p_lease: LEASE,
      p_error_code: null,
      p_permanent: false,
    });
    expect(JSON.stringify(sysRpc.mock.calls)).not.toMatch(/parent@example|Priya/);
  });

  it("reads a refund event's refund again from Stripe and syncs only that refund", async () => {
    expect((await send(post(refundFailed()))).status).toBe(200);
    expect(provider.retrieveRefund).toHaveBeenCalledWith("re_2");
    expect(sync.mock.calls.map((c) => c[3].id)).toEqual(["re_2"]);
  });

  it("flags a disputed order (a flag only; no money moves)", async () => {
    expect((await send(post(disputed()))).status).toBe(200);
    expect(provider.retrieveDispute).toHaveBeenCalledWith("dp_1");
    expect(names()).toEqual([
      "record_payment_stripe_event",
      "order_disputed",
      "finish_stripe_event",
    ]);
    expect(sysRpc.mock.calls[1]?.[2]).toEqual({ p_order_id: ORDER });
    expect(sync).not.toHaveBeenCalled();
  });

  it("keeps a refund made outside Daybell as a permanent, alerted problem and answers 200", async () => {
    sync.mockResolvedValue("external");
    expect((await send(post(refundFailed()))).status).toBe(200);
    expect(finish()).toMatchObject({ p_error_code: "external_refund", p_permanent: true });
    expect(JSON.stringify(logs[0]?.mock.calls)).toContain("stripe_webhook_permanent_failure");
  });

  it("makes a refund problem permanent, and retries while Stripe can't be reached (500)", async () => {
    sync.mockRejectedValue(new RefundProblem("refund_mismatch"));
    expect((await send(post(refundFailed()))).status).toBe(200);
    expect(finish()).toMatchObject({ p_error_code: "refund_mismatch", p_permanent: true });
    sysRpc.mockClear();
    const { ApiError } = await import("@daybell/api");
    sync.mockRejectedValue(new ApiError("internal", "Stripe is down."));
    expect((await send(post(refundFailed()))).status).toBe(500);
    expect(finish()).toMatchObject({ p_error_code: "stripe_unavailable", p_permanent: false });
  });

  it("acknowledges a payment that isn't Daybell's and records nothing", async () => {
    provider.retrievePaymentIntentIds.mockResolvedValue(
      payment({ orderId: null, studioId: null, region: null }),
    );
    expect((await send(post(refunded()))).status).toBe(200);
    expect(sysRpc).not.toHaveBeenCalled();
    provider.retrieveRefund.mockResolvedValue(facts("re_2", { paymentIntentId: null }));
    expect((await send(post(refundFailed()))).status).toBe(200);
    expect(provider.retrievePaymentIntentIds).toHaveBeenCalledTimes(1);
  });

  it("does nothing more for an event already processed, 409 while another delivery holds it, 404 for another database's order", async () => {
    sysRpc.mockImplementation(
      database({ record_payment_stripe_event: claim({ processed: true }) }),
    );
    expect((await send(post(refunded()))).status).toBe(200);
    expect(sync).not.toHaveBeenCalled();
    sysRpc.mockImplementation(
      database({ record_payment_stripe_event: claim({ claimed: false, lease: null }) }),
    );
    expect((await send(post(refunded()))).status).toBe(409);
    sysRpc.mockImplementation(
      database({ record_payment_stripe_event: { data: null, error: null } }),
    );
    expect((await send(post(refunded()))).status).toBe(404);
  });

  it("acknowledges an event for another payment than the order's for good (event_mismatch)", async () => {
    sysRpc.mockImplementation(database({ record_payment_stripe_event: claim({ mismatch: true }) }));
    expect((await send(post(refunded()))).status).toBe(200);
    expect(names()).toEqual(["record_payment_stripe_event"]);
    expect(logs[0]?.mock.calls).toEqual([
      ["stripe_webhook_permanent_failure", "charge.refunded", "event_mismatch"],
    ]);
  });

  it("never touches an order of another studio than the payment's own", async () => {
    provider.retrievePaymentIntentIds.mockResolvedValue(
      payment({ studioId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }),
    );
    expect((await send(post(disputed()))).status).toBe(200);
    expect(names()).not.toContain("order_disputed");
    expect(finish()).toMatchObject({ p_error_code: "studio_mismatch", p_permanent: true });
  });

  it("refuses a malformed object id before asking Stripe", async () => {
    const bad = event("refund.failed", { id: "ch_wrong_kind" });
    expect((await send(post(bad))).status).toBe(400);
    expect(provider.retrieveRefund).not.toHaveBeenCalled();
  });
});
