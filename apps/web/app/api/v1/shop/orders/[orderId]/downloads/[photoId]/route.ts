import { ApiError } from "@daybell/api";
import { after, NextResponse } from "next/server";
import { z } from "zod";
import { downloadLink } from "@/lib/checkout/downloads";
import { requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
// Canadian photos are signed in Montréal from ca-central-1 (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ orderId: string; photoId: string }> };

/**
 * GET /api/v1/shop/orders/:orderId/downloads/:photoId — a link to a paid photo (ADR 0023; calls 10, 11): the
 * full-resolution JPEG with its metadata stripped (never the original), signed for 5 minutes, saved under a name with
 * no name in it. The page goes to it straight away. Never cached, and never sent on as a Referer (next.config).
 */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { orderId, photoId } = await ctx.params;
  if (!z.uuid().safeParse(orderId).success || !z.uuid().safeParse(photoId).success)
    throw new ApiError("not_found", "Download not found.");
  return NextResponse.json(await downloadLink(session, orderId, photoId, after));
});
