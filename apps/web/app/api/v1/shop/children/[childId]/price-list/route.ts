import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireShopSession, shop, shopHandle, toShopPriceList } from "@/lib/shop/shop";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ childId: string }> };

/** GET /api/v1/shop/children/:childId/price-list — what the child's job sells now, before tax (ADR 0022). */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { childId } = await ctx.params;
  if (!z.uuid().safeParse(childId).success) throw new ApiError("not_found", "Child not found.");
  const row = await shop<Parameters<typeof toShopPriceList>[0]>(session.region, "shop_price_list", {
    p_session_hash: session.hash,
    p_child_id: childId,
  });
  return NextResponse.json(toShopPriceList(row));
});
