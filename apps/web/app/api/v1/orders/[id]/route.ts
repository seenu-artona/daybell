import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadOrderDetail, NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/orders/:id — one paid order (ADR 0024): its lines with what was refunded, status and tracking, totals
 * and fees, and for home delivery where it ships (call 2). Owners and admins also get its refunds, what is left to
 * refund and its ledger (Q4). Owners, admins and staff; another studio's order is not found.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { supabase, studio } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  return NextResponse.json(
    { order: await loadOrderDetail(supabase, studio, id) },
    { headers: NO_STORE },
  );
});
