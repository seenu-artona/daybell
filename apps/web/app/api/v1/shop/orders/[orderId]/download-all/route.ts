import { ApiError } from "@daybell/api";
import { z } from "zod";
import { downloadAll } from "@/lib/orders/zips";
import { requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
// Canadian photos are read in Montréal from ca-central-1 (D113); a zip of many full-resolution files takes a while.
export const preferredRegion = "yul1";
export const maxDuration = 300;

type Ctx = { params: Promise<{ orderId: string }> };

/**
 * GET /api/v1/shop/orders/:orderId/download-all — one zip of every paid download this gallery may have from the order
 * (ADR 0024): silverback-<reference>.zip, its files named as the single downloads are (never a child's name), streamed
 * from the studio's region with the download role. 409 shop.downloadPreparing with Retry-After while a file is being
 * made (never a partial zip); at most 10 zips a gallery an hour. Never cached.
 */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { orderId } = await ctx.params;
  if (!z.uuid().safeParse(orderId).success) throw new ApiError("not_found", "Order not found.");
  return downloadAll(session, orderId, request.signal);
});
