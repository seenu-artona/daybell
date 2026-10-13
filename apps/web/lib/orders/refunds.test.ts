import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Refunds (ADR 0024; Q1, Q2, Q7): Stripe refunds the parent Daybell's exact amount with Daybell's ids only and no
// Stripe flags; the studio's share (the refund less Daybell's fee on it) is taken back from the transfer as far as it
// goes and the rest is a shortfall; a refusal Stripe will never take cancels the refund (once the payment's refunds,
// listed again, hold none for it), anything else is retried; a run resumes where the last one stopped, even after a
// reversal was made and its record lost (code review B1); a refund that fails after its reversal sends the share
// back. Stripe's transfers and the database functions are faked in memory; nothing personal is logged.
vi.mock("server-only", () => ({}));
const { db, notes } = vi.hoisted(() => ({
  db: new Map<string, Record<string, unknown>>(),
  notes: [] as unknown[][],
}));
const call = vi.hoisted(() => vi.fn());
vi.mock("../supabase/service", () => ({
  orderSystemRpc: (_region: string, fn: string, args: Record<string, unknown>) => call(fn, args),
  checkoutSystemRpc: (_region: string, fn: string, args: Record<string, unknown>) => call(fn, args),
  orderWriteRpc: (_region: string, fn: string, actor: string, args: Record<string, unknown>) =>
    call(fn, { actor, ...args }),
}));

const { runRefund, tryRefund, syncStripeRefund, recoverShortfalls, startStudioRefund } =
  await import("./refunds");
const { StripeCallError } = await import("../stripe/errors");

const R = "aaaa0000-0000-4000-8000-000000000001";
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const SALE = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";

/** The database functions refunds.ts calls, keeping the refund as the migration would. */
function database(fn: string, args: Record<string, unknown>) {
  notes.push([fn, args]);
  const id = args.p_refund_id as string;
  const r = db.get(id);
  switch (fn) {
    case "refund_for_stripe":
      return { data: r ? { ...r } : null, error: null };
    case "refund_accepted": {
      if (!r) return { data: null, error: { code: "P0002" } };
      const s = args.p_stripe_status as string;
      Object.assign(r, {
        stripe_refund_id: args.p_stripe_refund_id,
        status: s === "failed" || s === "canceled" ? "failed" : s === "succeeded" ? s : "pending",
      });
      return { data: r.status, error: null };
    }
    case "refund_recovered": {
      if (!r) return { data: null, error: { code: "P0002" } };
      if (r.reversal_cents !== null) return { data: r.unrecovered, error: null };
      r.reversal_cents = args.p_cents;
      const owed = Number(r.reversal_needed_cents) - Number(args.p_cents);
      return { data: owed, error: null };
    }
    case "refund_settled":
      if (r && r.status === "pending") r.status = "succeeded";
      return { data: r?.status, error: null };
    case "refund_failed":
      if (r) {
        r.status = "failed";
        r.return_needed_cents = Number(r.reversal_cents ?? 0);
      }
      return { data: "failed", error: null };
    case "refund_share_returned":
      if (r) {
        r.returned_at = "2026-10-14T00:00:00Z";
        r.return_needed_cents = 0;
      }
      return { data: null, error: null };
    case "refund_abandoned":
      if (r && r.status === "requested") r.status = "canceled";
      return { data: null, error: null };
    case "begin_refund":
      return { data: { refund_id: R, created: true }, error: null };
    case "refund_by_stripe":
      return { data: args.p_refund_id === R ? R : null, error: null };
    case "refund_shortfalls_for_sale":
      return {
        data: [
          { refund_id: R, unrecovered_cents: 97 },
          { refund_id: "aaaa0000-0000-4000-8000-000000000002", unrecovered_cents: 500 },
        ],
        error: null,
      };
    default:
      return { data: null, error: null };
  }
}

const refundRow = (over: Record<string, unknown> = {}) => ({
  refund_id: R,
  order_id: ORDER,
  studio_id: "s",
  kind: "lines",
  reason: "damaged",
  status: "requested",
  amount_cents: 2260,
  daybell_fee_cents: 60,
  currency: "CAD",
  stripe_refund_id: null,
  reversal_cents: null,
  reversal_needed_cents: 2200,
  payment_intent_id: "pi_1",
  transfer_id: "tr_1",
  stripe_account_id: "acct_A1",
  returned_at: null,
  return_needed_cents: 0,
  ...over,
});

const stripeRefund = (over: Record<string, unknown> = {}) => ({
  id: "re_1",
  status: "succeeded",
  amountCents: 2260,
  currency: "cad",
  paymentIntentId: "pi_1",
  refundId: R,
  orderId: ORDER,
  region: "ca",
  failureReason: null,
  ...over,
});

/** Stripe's transfers, as the driver sees them: what each holds, and its reversals with Daybell's ids. */
const transfers = new Map<
  string,
  { amount: number; reversals: { id: string; amount: number; key: string }[] }
>();
const provider = {
  createRefund: vi.fn(),
  retrieveRefund: vi.fn(),
  findRefund: vi.fn(),
  reverseForRefund: vi.fn(),
  returnRefundShare: vi.fn(),
};
/** The real driver's rule: an earlier reversal for the refund (and sale) first, then at most what is left. */
async function reverseLikeStripe(input: {
  transferId: string;
  neededCents: number;
  refundId: string;
  purpose: string;
  orderId: string;
}) {
  const t = transfers.get(input.transferId);
  if (!t) throw new Error("no transfer");
  const key = `${input.purpose}:${input.refundId}:${input.purpose === "refund" ? "" : input.orderId}`;
  const earlier = t.reversals.find((r) => r.key === key);
  if (earlier) return { reversalId: earlier.id, amountCents: earlier.amount };
  const left = t.amount - t.reversals.reduce((sum, r) => sum + r.amount, 0);
  const amountCents = Math.min(input.neededCents, Math.max(0, left));
  if (amountCents <= 0) return { reversalId: null, amountCents: 0 };
  const id = `trr_${t.reversals.length + 1}`;
  t.reversals.push({ id, amount: amountCents, key });
  return { reversalId: id, amountCents };
}
const asProvider = () => provider as unknown as Parameters<typeof runRefund>[1];
let logs: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  db.clear();
  notes.length = 0;
  transfers.clear();
  transfers.set("tr_1", { amount: 12_253, reversals: [] });
  transfers.set("tr_sale", { amount: 300, reversals: [] });
  call.mockImplementation(database);
  provider.createRefund.mockResolvedValue(stripeRefund());
  provider.retrieveRefund.mockResolvedValue(stripeRefund());
  provider.findRefund.mockResolvedValue(null);
  provider.reverseForRefund.mockImplementation(reverseLikeStripe);
  provider.returnRefundShare.mockResolvedValue({ transferId: "tr_back" });
  logs = (["log", "warn", "error"] as const).map((m) =>
    vi.spyOn(console, m).mockImplementation(() => {}),
  );
});
afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});
const logged = () => JSON.stringify(logs.flatMap((spy) => spy.mock.calls));

describe("runRefund (Q1)", () => {
  it("refunds Daybell's exact amount with its ids and no flags, then takes the studio's share back", async () => {
    db.set(R, refundRow());
    expect(await runRefund("ca", asProvider(), R)).toBe("succeeded");
    expect(provider.createRefund).toHaveBeenCalledWith({
      paymentIntentId: "pi_1",
      amountCents: 2260,
      refundId: R,
      orderId: ORDER,
      region: "ca",
      reason: null,
    });
    expect(notes).toContainEqual([
      "refund_accepted",
      { p_refund_id: R, p_stripe_refund_id: "re_1", p_stripe_status: "succeeded" },
    ]);
    // 2,260 less Daybell's 60: the studio gives back 2,200 from its transfer.
    expect(provider.reverseForRefund).toHaveBeenCalledWith({
      transferId: "tr_1",
      neededCents: 2200,
      refundId: R,
      purpose: "refund",
      orderId: ORDER,
    });
    expect(notes).toContainEqual([
      "refund_recovered",
      { p_refund_id: R, p_reversal_id: "trr_1", p_cents: 2200 },
    ]);
    expect(logged()).toBe("[]");
  });

  it("tells Stripe a parent asked only for a cancel or that reason, never fraudulent", async () => {
    db.set(R, refundRow({ kind: "cancel", reason: "parent_asked" }));
    await runRefund("ca", asProvider(), R);
    expect(provider.createRefund.mock.calls[0]?.[0]).toMatchObject({
      reason: "requested_by_customer",
    });
  });

  it("takes only what the transfer still holds: the rest is a shortfall (Q2)", async () => {
    // The card fee was reversed at payment: 10,053 left of the 10,150 a cancel needs.
    db.set(
      R,
      refundRow({ amount_cents: 10_390, daybell_fee_cents: 240, reversal_needed_cents: 10_150 }),
    );
    provider.createRefund.mockResolvedValue(stripeRefund({ amountCents: 10_390 }));
    transfers.set("tr_1", { amount: 10_053, reversals: [] });
    await runRefund("ca", asProvider(), R);
    expect(notes).toContainEqual([
      "refund_recovered",
      { p_refund_id: R, p_reversal_id: "trr_1", p_cents: 10_053 },
    ]);
    expect(logged()).toBe('[["refund_shortfall"]]');
  });

  it("records a reversal of nothing when the transfer is empty", async () => {
    db.set(R, refundRow());
    transfers.set("tr_1", { amount: 0, reversals: [] });
    await runRefund("ca", asProvider(), R);
    expect(notes).toContainEqual([
      "refund_recovered",
      { p_refund_id: R, p_reversal_id: null, p_cents: 0 },
    ]);
  });

  it("resumes where it stopped: an accepted refund is asked about, never made again", async () => {
    db.set(R, refundRow({ status: "pending", stripe_refund_id: "re_1" }));
    expect(await runRefund("ca", asProvider(), R)).toBe("succeeded");
    expect(provider.createRefund).not.toHaveBeenCalled();
    expect(provider.retrieveRefund).toHaveBeenCalledWith("re_1");
    expect(provider.reverseForRefund).toHaveBeenCalledTimes(1);
    // Again: nothing left to do.
    provider.reverseForRefund.mockClear();
    expect(await runRefund("ca", asProvider(), R)).toBe("succeeded");
    expect(provider.reverseForRefund).not.toHaveBeenCalled();
  });

  it("resumes after a reversal was made but its record lost, the transfer now empty: no shortfall (code review B1)", async () => {
    db.set(
      R,
      refundRow({ amount_cents: 10_390, daybell_fee_cents: 240, reversal_needed_cents: 10_150 }),
    );
    provider.createRefund.mockResolvedValue(stripeRefund({ amountCents: 10_390 }));
    transfers.set("tr_1", { amount: 10_053, reversals: [] });
    // The first run makes the reversal of 10,053, then the database write is lost.
    call.mockImplementation((fn: string, args: Record<string, unknown>) =>
      fn === "refund_recovered" ? { data: null, error: { code: "57014" } } : database(fn, args),
    );
    await expect(runRefund("ca", asProvider(), R)).rejects.toThrow();
    expect(transfers.get("tr_1")?.reversals).toHaveLength(1);
    // The retry finds that reversal, though the transfer holds nothing now: 10,053 recorded, 97 owed, not 10,150.
    call.mockImplementation(database);
    notes.length = 0;
    await runRefund("ca", asProvider(), R);
    expect(notes).toContainEqual([
      "refund_recovered",
      { p_refund_id: R, p_reversal_id: "trr_1", p_cents: 10_053 },
    ]);
    expect(transfers.get("tr_1")?.reversals).toHaveLength(1);
  });

  it("finds a refund Stripe made though its answer was refused, and never cancels it (security review S1)", async () => {
    db.set(R, refundRow());
    provider.createRefund.mockRejectedValueOnce(
      new StripeCallError("x", "other", "refused", undefined, "StripeInvalidRequestError"),
    );
    provider.findRefund.mockResolvedValue(stripeRefund({ id: "re_raced" }));
    expect(await runRefund("ca", asProvider(), R)).toBe("succeeded");
    expect(provider.findRefund).toHaveBeenCalledWith("pi_1", R);
    expect(notes.map((n) => n[0])).not.toContain("refund_abandoned");
    expect(notes).toContainEqual([
      "refund_accepted",
      { p_refund_id: R, p_stripe_refund_id: "re_raced", p_stripe_status: "succeeded" },
    ]);
  });

  it("sends the share back to the studio when a refund fails after its reversal (Q7)", async () => {
    db.set(R, refundRow({ status: "pending", stripe_refund_id: "re_1", reversal_cents: 2200 }));
    provider.retrieveRefund.mockResolvedValue(
      stripeRefund({ status: "failed", failureReason: "expired_or_canceled_card" }),
    );
    expect(await runRefund("ca", asProvider(), R)).toBe("failed");
    expect(provider.returnRefundShare).toHaveBeenCalledWith({
      accountId: "acct_A1",
      amountCents: 2200,
      currency: "cad",
      refundId: R,
      orderId: ORDER,
    });
    expect(notes).toContainEqual([
      "refund_share_returned",
      { p_refund_id: R, p_transfer_id: "tr_back", p_cents: 2200 },
    ]);
    // Again (the cron): nothing more to send.
    provider.returnRefundShare.mockClear();
    expect(await runRefund("ca", asProvider(), R)).toBe("failed");
    expect(provider.returnRefundShare).not.toHaveBeenCalled();
  });

  it("mirrors a refund Stripe then says failed", async () => {
    db.set(R, refundRow({ status: "pending", stripe_refund_id: "re_1" }));
    provider.retrieveRefund.mockResolvedValue(
      stripeRefund({ status: "failed", failureReason: "expired_or_canceled_card" }),
    );
    expect(await runRefund("ca", asProvider(), R)).toBe("failed");
    expect(notes).toContainEqual([
      "refund_failed",
      { p_refund_id: R, p_code: "expired_or_canceled_card" },
    ]);
    expect(provider.reverseForRefund).not.toHaveBeenCalled();
  });

  it("cancels a refund Stripe will never take, and retries one it refused for now", async () => {
    db.set(R, refundRow());
    provider.createRefund.mockRejectedValueOnce(
      new StripeCallError("x", "other", "refused", undefined, "StripeInvalidRequestError"),
    );
    expect(await runRefund("ca", asProvider(), R)).toBe("canceled");
    expect(notes).toContainEqual([
      "refund_abandoned",
      { p_refund_id: R, p_code: "stripe_refused" },
    ]);
    db.set(R, refundRow());
    provider.createRefund.mockRejectedValueOnce(
      new StripeCallError("x", "other", "refused", undefined, "StripeRateLimitError"),
    );
    await expect(runRefund("ca", asProvider(), R)).rejects.toThrow(StripeCallError);
    expect(db.get(R)?.status).toBe("requested");
  });

  it("refuses Stripe's answer for another amount or another refund (a problem for support)", async () => {
    db.set(R, refundRow());
    provider.createRefund.mockResolvedValue(stripeRefund({ amountCents: 1 }));
    await expect(runRefund("ca", asProvider(), R)).rejects.toThrow("refund_mismatch");
    provider.createRefund.mockResolvedValue(stripeRefund({ refundId: "someone-else" }));
    await expect(runRefund("ca", asProvider(), R)).rejects.toThrow("refund_mismatch");
  });

  it("refuses outside Montréal before asking Stripe anything (D113)", async () => {
    vi.stubEnv("VERCEL_REGION", "iad1");
    db.set(R, refundRow());
    await expect(runRefund("ca", asProvider(), R)).rejects.toThrow();
    expect(provider.createRefund).not.toHaveBeenCalled();
    vi.unstubAllEnvs();
  });
});

describe("tryRefund and the studio's refund", () => {
  it("leaves a refund asked for when Stripe can't be reached, noting it for the cron", async () => {
    db.set(R, refundRow());
    provider.createRefund.mockRejectedValue(
      new StripeCallError("x", "other", "unknown", undefined, "StripeAPIError"),
    );
    expect(await tryRefund("ca", asProvider(), R)).toBe("requested");
    expect(notes).toContainEqual([
      "note_refund_failure",
      { p_refund_id: R, p_code: "stripe_unavailable", p_permanent: false },
    ]);
    expect(logged()).toBe('[["refund_retry_later","stripe_unavailable"]]');
  });

  it("writes the refund as asked (ids and quantities only), then makes it", async () => {
    db.set(R, refundRow());
    const id = await startStudioRefund("ca", asProvider(), "user-1", "s", ORDER, {
      requestId: "b0000000-0000-4000-8000-000000000001",
      kind: "lines",
      lines: [{ lineId: "l1", quantity: 2 }],
      shipping: true,
      reason: "damaged",
    });
    expect(id).toBe(R);
    expect(notes[0]).toEqual([
      "begin_refund",
      {
        actor: "user-1",
        p_studio_id: "s",
        p_order_id: ORDER,
        p_request_id: "b0000000-0000-4000-8000-000000000001",
        p_kind: "lines",
        p_lines: [{ line_id: "l1", quantity: 2 }],
        p_custom_cents: null,
        p_shipping: true,
        p_reason: "damaged",
      },
    ]);
  });

  it("says a refund Stripe refused was refused", async () => {
    db.set(R, refundRow());
    provider.createRefund.mockRejectedValue(
      new StripeCallError("x", "other", "refused", undefined, "StripeInvalidRequestError"),
    );
    await expect(
      startStudioRefund("ca", asProvider(), "user-1", "s", ORDER, {
        requestId: "b0000000-0000-4000-8000-000000000001",
        kind: "custom",
        amountCents: 100,
        shipping: false,
        reason: null,
      }),
    ).rejects.toMatchObject({ code: "conflict", fields: { form: "orders.refundRefused" } });
  });
});

describe("Stripe's word on a refund (the webhook)", () => {
  it("keeps a refund made outside Daybell on the order and flags it, which rings the bell (security review S5)", async () => {
    expect(
      await syncStripeRefund("ca", asProvider(), ORDER, stripeRefund({ refundId: null }) as never),
    ).toBe("external");
    expect(notes).toContainEqual([
      "note_checkout_failure",
      { p_order_id: ORDER, p_code: "external_refund", p_permanent: true },
    ]);
    expect(notes).toContainEqual(["order_external_refund", { p_order_id: ORDER }]);
  });

  it("treats a refund Stripe made after Daybell gave it up as a problem, alerted, never synced (security review S1)", async () => {
    db.set(R, refundRow({ status: "canceled" }));
    expect(await syncStripeRefund("ca", asProvider(), ORDER, stripeRefund() as never)).toBe(
      "external",
    );
    expect(notes).toContainEqual([
      "note_refund_failure",
      { p_refund_id: R, p_code: "refund_after_abandoned", p_permanent: true },
    ]);
    expect(notes).toContainEqual(["order_external_refund", { p_order_id: ORDER }]);
    expect(logged()).toContain("refund_made_after_abandoned");
    expect(provider.createRefund).not.toHaveBeenCalled();
  });

  it("takes Daybell's own as far as it goes, then fails it if Stripe says so", async () => {
    db.set(R, refundRow({ status: "succeeded", stripe_refund_id: "re_1", reversal_cents: 2200 }));
    expect(
      await syncStripeRefund(
        "ca",
        asProvider(),
        ORDER,
        stripeRefund({ status: "failed", failureReason: "lost_or_stolen_card" }) as never,
      ),
    ).toBe("synced");
    expect(notes).toContainEqual([
      "refund_failed",
      { p_refund_id: R, p_code: "lost_or_stolen_card" },
    ]);
  });
});

describe("recoverShortfalls (Q2)", () => {
  it("takes what is owed from a later sale's transfer, oldest first, as far as it goes", async () => {
    expect(await recoverShortfalls("ca", asProvider(), SALE, "tr_sale")).toBe(2);
    expect(provider.reverseForRefund.mock.calls.map((c) => c[0])).toEqual([
      {
        transferId: "tr_sale",
        neededCents: 97,
        refundId: R,
        purpose: "refund_shortfall",
        orderId: SALE,
      },
      {
        transferId: "tr_sale",
        neededCents: 500,
        refundId: "aaaa0000-0000-4000-8000-000000000002",
        purpose: "refund_shortfall",
        orderId: SALE,
      },
    ]);
    expect(notes).toContainEqual([
      "refund_shortfall_recovered",
      { p_refund_id: R, p_order_id: SALE, p_cents: 97, p_reversal_id: "trr_1" },
    ]);
    expect(notes).toContainEqual([
      "refund_shortfall_recovered",
      {
        p_refund_id: "aaaa0000-0000-4000-8000-000000000002",
        p_order_id: SALE,
        p_cents: 203,
        p_reversal_id: "trr_2",
      },
    ]);
  });

  it("stops once the transfer is empty", async () => {
    transfers.set("tr_sale", { amount: 97, reversals: [] });
    expect(await recoverShortfalls("ca", asProvider(), SALE, "tr_sale")).toBe(1);
  });

  it("records an earlier recovery whose record was lost, though it emptied the transfer (code review B1)", async () => {
    transfers.set("tr_sale", { amount: 97, reversals: [] });
    call.mockImplementation((fn: string, args: Record<string, unknown>) =>
      fn === "refund_shortfall_recovered"
        ? { data: null, error: { code: "57014" } }
        : database(fn, args),
    );
    expect(await recoverShortfalls("ca", asProvider(), SALE, "tr_sale")).toBe(0);
    call.mockImplementation(database);
    notes.length = 0;
    expect(await recoverShortfalls("ca", asProvider(), SALE, "tr_sale")).toBe(1);
    expect(notes).toContainEqual([
      "refund_shortfall_recovered",
      { p_refund_id: R, p_order_id: SALE, p_cents: 97, p_reversal_id: "trr_1" },
    ]);
    expect(transfers.get("tr_sale")?.reversals).toHaveLength(1);
  });

  it("never fails the sale: a failure is logged by name", async () => {
    provider.reverseForRefund.mockRejectedValue(new Error("down"));
    expect(await recoverShortfalls("ca", asProvider(), SALE, "tr_sale")).toBe(0);
    expect(logged()).toBe('[["refund_shortfall_recovery_failed"]]');
  });
});
