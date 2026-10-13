import { cancelCheckout } from "@/lib/checkout/start";
import { requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/checkout/cancel — back from Stripe without paying (ADR 0023 §5.1): the gallery's open checkouts
 * are expired at Stripe and here, so a stale tab can't pay later. The bag is unchanged.
 */
export const POST = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  await cancelCheckout(session);
  return new Response(null, { status: 204 });
});
