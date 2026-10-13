import { NextResponse } from "next/server";
import { type DbShopOrderSummary, toShopOrderSummary } from "@/lib/checkout/orders";
import { callShopFunction, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * GET /api/v1/shop/orders — "Your orders" (ADR 0023 §6; call 12): the paid orders this gallery may see and its own
 * checkouts of the last 2 hours. A child's other parent sees that child's part only; nobody sees an email.
 */
export const GET = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  const rows = await callShopFunction<DbShopOrderSummary[]>(session.region, "shop_orders", {
    p_session_hash: session.hash,
  });
  return NextResponse.json({ orders: rows.map(toShopOrderSummary) });
});
