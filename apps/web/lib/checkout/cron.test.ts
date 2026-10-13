import { afterEach, describe, expect, it, vi } from "vitest";

// The jobs cron's checkout backstops (ADR 0023 §5.5): paid orders whose Stripe fee came late are completed again and
// settled; checkouts that ran out are expired at Stripe and here, or completed if Stripe says paid; a failure is logged
// by a fixed name and left for the next run; the region's time is respected.
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
      ["checkout_cron_failed", "settle", "error"],
      ["checkout_cron_failed", "expire", "error"],
    ]);
    provider.retrieveCheckoutSession.mockClear();
    await runCheckoutBackstops("ca", provider as never, Date.now() - 1);
    expect(provider.retrieveCheckoutSession).not.toHaveBeenCalled();
    errors.mockRestore();
  });
});
