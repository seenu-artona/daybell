import { afterEach, describe, expect, it, vi } from "vitest";

// A parent's cancel (ADR 0024; answer 2; Q5, Q6): the database writes the cancel (and counts every try, repeats
// included: security review S3); Stripe is asked for a new cancel, and for a repeat only when the cancel it names has
// waited 30 seconds without Stripe; a cancel that failed or that Stripe refused is said so (code review S1: the next try
// is a new cancel, made by the database).
vi.mock("server-only", () => ({}));
const { shopFn, tryRefund } = vi.hoisted(() => ({ shopFn: vi.fn(), tryRefund: vi.fn() }));
vi.mock("@/lib/shop/http", async (original) => ({
  ...(await original<typeof import("@/lib/shop/http")>()),
  requireShopSession: async () => ({ region: "ca", hash: "h" }),
  callShopFunction: shopFn,
}));
vi.mock("@/lib/orders/refunds", () => ({ tryRefund }));
vi.mock("@/lib/checkout/start", () => ({ checkoutPayments: () => ({}) }));
vi.mock("@/lib/checkout/orders", () => ({ toShopOrder: (row: unknown) => row }));
vi.mock("@/lib/region-guard", () => ({ assertPayoutRegion: vi.fn() }));

const ORDER = "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c";
const R = "aaaa0000-0000-4000-8000-000000000001";
const post = async () =>
  (await import("./route")).POST(
    new Request(`http://localhost/api/v1/shop/orders/${ORDER}/cancel`, { method: "POST" }),
    { params: Promise.resolve({ orderId: ORDER }) },
  );
const begun = (over: Record<string, unknown>) =>
  shopFn.mockImplementation(async (_region: string, fn: string) =>
    fn === "shop_order_cancel_begin"
      ? { refund_id: R, created: false, status: "requested", stale: false, ...over }
      : { id: ORDER, fulfilment: "canceled" },
  );

afterEach(() => vi.clearAllMocks());

describe("POST /shop/orders/:orderId/cancel", () => {
  it("asks Stripe for a new cancel and answers the order", async () => {
    begun({ created: true });
    tryRefund.mockResolvedValue("succeeded");
    const res = await post();
    expect(res.status).toBe(200);
    expect(tryRefund).toHaveBeenCalledWith("ca", {}, R);
    expect((await res.json()).order).toEqual({ id: ORDER, fulfilment: "canceled" });
  });

  it("never asks Stripe again for a repeat while the cancel is fresh or done (security review S3)", async () => {
    begun({ status: "requested", stale: false });
    expect((await post()).status).toBe(200);
    begun({ status: "succeeded", stale: true });
    expect((await post()).status).toBe(200);
    expect(tryRefund).not.toHaveBeenCalled();
  });

  it("asks again for a repeat whose cancel has waited 30 seconds", async () => {
    begun({ status: "requested", stale: true });
    tryRefund.mockResolvedValue("pending");
    expect((await post()).status).toBe(200);
    expect(tryRefund).toHaveBeenCalledTimes(1);
  });

  it("says a cancel Stripe refused couldn't be made", async () => {
    begun({ created: true });
    tryRefund.mockResolvedValue("canceled");
    const res = await post();
    expect(res.status).toBe(409);
    expect((await res.json()).error.fields).toEqual({ form: "shop.cannotCancel" });
  });
});
