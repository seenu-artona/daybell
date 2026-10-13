import { shopCartLineInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { parseBody } from "@/lib/api";
import { readCart, requireShopSession, shop, shopHandle } from "@/lib/shop/shop";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/shop/cart/lines — adds to the bag (calls 8, 9; ADR 0022). The database checks the child, the shop,
 * the item and the pose; nothing priced here is stored.
 */
export const POST = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  const input = await parseBody(request, shopCartLineInput);
  await shop<string>(session.region, "shop_cart_add", {
    p_session_hash: session.hash,
    p_child_id: input.childId,
    p_item_id: input.itemId,
    p_photo_id: input.photoId,
    p_quantity: input.quantity,
  });
  return NextResponse.json(await readCart(session), { status: 201 });
});
