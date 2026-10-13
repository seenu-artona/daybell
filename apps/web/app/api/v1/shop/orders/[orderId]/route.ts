import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { CheckoutProblem, completeCheckout } from "@/lib/checkout/complete";
import { type DbShopOrder, toShopOrder } from "@/lib/checkout/orders";
import { checkoutPayments } from "@/lib/checkout/start";
import { callShopFunction, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * GET /api/v1/shop/orders/:orderId — the confirmation page's order (ADR 0023 §5.4). While the gallery's own order is
 * pending, Stripe is asked whether it was paid, at most every 5 seconds (the database keeps the time), so the page is
 * right even when Stripe's webhook is late. A failure to ask is logged by a fixed name and the order shown as it is.
 */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { orderId } = await ctx.params;
  if (!z.uuid().safeParse(orderId).success) throw new ApiError("not_found", "Order not found.");
  const checkout = await callShopFunction<string | null>(session.region, "shop_order_verify", {
    p_session_hash: session.hash,
    p_order_id: orderId,
  });
  if (checkout) {
    try {
      await completeCheckout(session.region, checkoutPayments(), checkout, {
        expectedOrderId: orderId,
      });
    } catch (err) {
      console.error(
        "checkout_verify_failed",
        err instanceof CheckoutProblem ? err.code : err instanceof ApiError ? err.code : "unknown",
      );
    }
  }
  const row = await callShopFunction<DbShopOrder>(session.region, "shop_order", {
    p_session_hash: session.hash,
    p_order_id: orderId,
  });
  return NextResponse.json({ order: toShopOrder(row) });
});
