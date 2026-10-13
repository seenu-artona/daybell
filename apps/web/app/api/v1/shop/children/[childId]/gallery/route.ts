import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireShopSession, shop, shopHandle, toShopGallery } from "@/lib/shop/shop";

export const runtime = "nodejs";
// Canadian photos are signed in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ childId: string }> };

/**
 * GET /api/v1/shop/children/:childId/gallery — the cover, portraits and class photo set of a child in the session,
 * as watermarked, low-resolution previews signed for 10 minutes (D60, D119; ADR 0022). Never originals.
 */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { childId } = await ctx.params;
  if (!z.uuid().safeParse(childId).success) throw new ApiError("not_found", "Child not found.");
  const row = await shop<Parameters<typeof toShopGallery>[1]>(session.region, "shop_gallery", {
    p_session_hash: session.hash,
    p_child_id: childId,
  });
  return NextResponse.json(await toShopGallery(session.region, row));
});
