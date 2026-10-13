import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { type DbStudioOrderDetail, toStudioOrderDetail } from "@/lib/checkout/orders";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/orders/:id — one paid order: its lines with the children's names, package contents and, for home
 * delivery, where it ships (call 2). Owners and admins (call 15). Another studio's order is not found.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { supabase, studio } = await studioScope();
  assertCanSeePayouts(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  const row = check(
    await supabase.rpc("studio_order", { p_studio_id: studio.id, p_order_id: id }),
  ) as DbStudioOrderDetail | null;
  if (!row) throw new ApiError("not_found", "Order not found.");
  return NextResponse.json(
    { order: toStudioOrderDetail(row) },
    { headers: { "cache-control": "private, no-store" } },
  );
});
