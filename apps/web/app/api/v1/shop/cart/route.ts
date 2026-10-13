import { NextResponse } from "next/server";
import { readCart, requireShopSession, shopHandle } from "@/lib/shop/shop";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/** GET /api/v1/shop/cart — the bag, priced from each job's current list now (ADR 0022). */
export const GET = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  return NextResponse.json(await readCart(session));
});
