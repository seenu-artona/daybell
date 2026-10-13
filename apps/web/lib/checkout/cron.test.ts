import { ApiError } from "@daybell/api";
import { afterEach, describe, expect, it, vi } from "vitest";

// The jobs cron's checkout backstops (ADR 0023 §5.5): paid orders whose Stripe fee came late are completed again and
// settled; checkouts that ran out are expired at Stripe and here, or completed if Stripe says paid; a failure is logged
// by a fixed name and noted on the order with its code, backing off, and a problem no retry can fix is noted as
// permanent so it never comes back (code review S1, security review M4); the region's time is respected.
vi.mock("server-only", () => ({}));
const { sysRpc } = vi.hoisted(() => ({ sysRpc: vi.fn() }));
vi.mock("../supabase/service", () => ({ checkoutSystemRpc: sysRpc }));

const { runCheckoutBackstops } = await import("./cron");
const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const STALE = "0d0d0d0d-0d0d-4d0d-8d0d-0d0d0d0d0d0d";

const provider = {
  driver: "fake" as const,
  livemode: false,
  retrieveCheckoutSession: vi.fn(),
  expireCheckoutSession: vi.fn(),
  recoverCardFee: vi.fn(async () => ({ reversalId: "trr_1" })),
  setReceiptEmail: vi.fn(),
};
const paid = {
  id: "cs_test_fakeA",
  status: "complete",
  paymentStatus: "paid",
  orderId: ORDER,
  transferId: "tr_1",
  currency: "cad",
  amountTotal: 10000,
  applicationFeeAmount: 300,
  balanceTransaction: { id: "txn_1", feeCents: 100, currency: "cad" },
  receiptEmail: null,
};

afterEach(() => vi.clearAllMocks());

describe("runCheckoutBackstops", () => {
  it("settles late fees and expires checkouts that ran out", async () => {
    sysRpc.mockImplementation(async (_region: string, fn: string) => ({
      data:
        fn === "unsettled_orders"
          ? [{ order_id: ORDER, checkout_session_id: "cs_test_fakeA" }]
          : fn === "stale_checkouts"
            ? [
                { order_id: STALE, checkout_session_id: "cs_test_fakeB" },
                { order_id: "0e0e0e0e-0e0e-4e0e-8e0e-0e0e0e0e0e0e", checkout_session_id: null },
              ]
            : fn === "complete_order"
              ? "already_paid"
              : fn === "settle_order_fees"
                ? "settled"
                : true,
      error: null,
    }));
    provider.retrieveCheckoutSession.mockResolvedValue(paid);
    provider.expireCheckoutSession.mockResolvedValue({ status: "expired" });
    const done = await runCheckoutBackstops("ca", provider as never, Date.now() + 60_000);
    expect(done).toEqual({ settledOrders: 1, expiredOrders: 2 });
    expect(provider.recoverCardFee).toHaveBeenCalledWith({
      transferId: "tr_1",
      amountCents: 100,
      orderId: ORDER,
    });
    expect(provider.expireCheckoutSession).toHaveBeenCalledWith("cs_test_fakeB");
    expect(
      sysRpc.mock.calls.filter((c) => c[1] === "expire_order").map((c) => c[2].p_order_id),
    ).toHaveLength(2);
  });

  it("logs a failure by name only and carries on; stops when the time is up", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    sysRpc.mockImplementation(async (_region: string, fn: string) => ({
      data:
        fn === "unsettled_orders"
          ? [{ order_id: ORDER, checkout_session_id: "cs_test_fakeA" }]
          : fn === "stale_checkouts"
            ? [{ order_id: STALE, checkout_session_id: "cs_test_fakeB" }]
            : null,
      error: null,
    }));
    provider.retrieveCheckoutSession.mockRejectedValue(new Error("down"));
    provider.expireCheckoutSession.mockRejectedValue(new Error("down"));
    expect(await runCheckoutBackstops("ca", provider as never, Date.now() + 60_000)).toEqual({
      settledOrders: 0,
      expiredOrders: 0,
    });
    expect(errors.mock.calls).toEqual([
      ["checkout_cron_failed", "settle", "unexpected_error"],
      ["checkout_cron_failed", "expire", "unexpected_error"],
    ]);
    // Noted on each order, so the next run backs off instead of trying it first again.
    expect(
      sysRpc.mock.calls.filter((c) => c[1] === "note_checkout_failure").map((c) => c[2]),
    ).toEqual([
      { p_order_id: ORDER, p_code: "unexpected_error", p_permanent: false },
      { p_order_id: STALE, p_code: "unexpected_error", p_permanent: false },
    ]);
    provider.retrieveCheckoutSession.mockClear();
    await runCheckoutBackstops("ca", provider as never, Date.now() - 1);
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("notes Stripe being down as a retry, a mismatch as a problem for good, and a fee still unknown as a retry", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const PROBLEM = "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f";
    sysRpc.mockImplementation(async (_region: string, fn: string) => ({
      data:
        fn === "unsettled_orders"
          ? [
              { order_id: ORDER, checkout_session_id: "cs_test_fakeA" },
              { order_id: PROBLEM, checkout_session_id: "cs_test_fakeC" },
            ]
          : fn === "stale_checkouts"
            ? [{ order_id: STALE, checkout_session_id: "cs_test_fakeB" }]
            : fn === "complete_order"
              ? "already_paid"
              : true,
      error: null,
    }));
    provider.retrieveCheckoutSession
      // Paid, but Stripe's fee isn't known yet.
      .mockResolvedValueOnce({ ...paid, balanceTransaction: null })
      // Stripe names another order: a mismatch no retry can fix.
      .mockResolvedValueOnce({ ...paid, id: "cs_test_fakeC" });
    provider.expireCheckoutSession.mockRejectedValue(
      new ApiError("internal", "We couldn't reach Stripe. Please try again."),
    );
    await runCheckoutBackstops("ca", provider as never, Date.now() + 60_000);
    expect(
      sysRpc.mock.calls.filter((c) => c[1] === "note_checkout_failure").map((c) => c[2]),
    ).toEqual([
      { p_order_id: ORDER, p_code: "fee_pending", p_permanent: false },
      // Recorded by the completion itself, then by the cron.
      { p_order_id: PROBLEM, p_code: "checkout_mismatch", p_permanent: true },
      { p_order_id: PROBLEM, p_code: "checkout_mismatch", p_permanent: true },
      { p_order_id: STALE, p_code: "stripe_unavailable", p_permanent: false },
    ]);
    expect(provider.recoverCardFee).not.toHaveBeenCalled();
    expect(JSON.stringify(errors.mock.calls)).not.toMatch(/cs_test|0f0f|0c0c|0d0d/);
    errors.mockRestore();
  });
});
