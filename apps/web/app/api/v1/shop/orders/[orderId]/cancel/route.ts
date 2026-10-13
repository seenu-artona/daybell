import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { type DbShopOrder, toShopOrder } from "@/lib/checkout/orders";
import { checkoutPayments } from "@/lib/checkout/start";
import { tryRefund } from "@/lib/orders/refunds";
import { assertPayoutRegion } from "@/lib/region-guard";
import { callShopFunction, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * POST /api/v1/shop/orders/:orderId/cancel — a parent cancels for a full refund (ADR 0024; answer 2; Q5, Q6): only the
 * gallery that paid, while the order isn't printed yet, never a downloads-only order. The database writes the refund of
 * everything left (shipping included; 5 cancels a gallery an hour); Stripe refunds it (lib/orders/refunds.ts) and the
 * order is cancelled once Stripe accepts it. Stripe unreachable: the refund stays asked for, the cron finishes it, and
 * the page shows it on its way. Answers the order.
 */
export const POST = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { orderId } = await ctx.params;
  if (!z.uuid().safeParse(orderId).success) throw new ApiError("not_found", "Order not found.");
  assertPayoutRegion(session.region);
  const begun = await callShopFunction<{ refund_id: string; created: boolean }>(
    session.region,
    "shop_order_cancel_begin",
    { p_session_hash: session.hash, p_order_id: orderId },
  );
  const status = await tryRefund(session.region, checkoutPayments(), begun.refund_id);
  if (status === "canceled" || status === "failed")
    throw new ApiError("conflict", "This order couldn't be cancelled. Contact the studio.", {
      form: "shop.cannotCancel",
    });
  const row = await callShopFunction<DbShopOrder>(session.region, "shop_order", {
    p_session_hash: session.hash,
    p_order_id: orderId,
  });
  return NextResponse.json({ order: toShopOrder(row) });
});
