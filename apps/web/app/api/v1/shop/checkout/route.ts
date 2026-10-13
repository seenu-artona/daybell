import { NextResponse } from "next/server";
import { startCheckout } from "@/lib/checkout/start";
import { requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
// Canadian parents' orders are written and sent to Stripe from Montréal (D113).
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/checkout — pay for the gallery's bag (ADR 0023 §5.1; D97, D106). No body: the bag is priced again
 * from each job's current list and copied into an order before Stripe is asked for its hosted checkout. Answers the
 * order and Stripe's address; the page goes there straight away.
 */
export const POST = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  return NextResponse.json(await startCheckout(session), { status: 201 });
});
