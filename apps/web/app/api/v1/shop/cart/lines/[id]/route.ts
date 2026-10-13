import { shopQuantityInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { pathId } from "@/lib/roster";
import { readCart, requireShopSession, shop, shopHandle } from "@/lib/shop/shop";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH /api/v1/shop/cart/lines/:id — how many (1 to 99; downloads stay 1). */
export const PATCH = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const lineId = await pathId(ctx, "Not in the bag.");
  const { quantity } = await parseBody(request, shopQuantityInput);
  await shop<null>(session.region, "shop_cart_set_quantity", {
    p_session_hash: session.hash,
    p_line_id: lineId,
    p_quantity: quantity,
  });
  return NextResponse.json(await readCart(session));
});

/** DELETE /api/v1/shop/cart/lines/:id — out of the bag. */
export const DELETE = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const lineId = await pathId(ctx, "Not in the bag.");
  await shop<null>(session.region, "shop_cart_remove", {
    p_session_hash: session.hash,
    p_line_id: lineId,
  });
  return NextResponse.json(await readCart(session));
});
