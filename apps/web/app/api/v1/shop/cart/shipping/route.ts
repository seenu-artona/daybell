import { shopShippingInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { readCart, requireShopSession, shop, shopHandle } from "@/lib/shop/shop";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/** PUT /api/v1/shop/cart/shipping — home, or school when every job with something to deliver allows it (call 9). */
export const PUT = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  const { method } = await parseBody(request, shopShippingInput);
  await shop<null>(session.region, "shop_set_shipping", {
    p_session_hash: session.hash,
    p_method: method,
  });
  return NextResponse.json(await readCart(session));
});
