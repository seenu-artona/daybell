import { ApiError, refundInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { startStudioRefund } from "@/lib/orders/refunds";
import { loadOrderDetail, NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { payments } from "@/lib/stripe";
import { assertCanRefund, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/orders/:id/refunds — a refund (ADR 0024; answers 1, 3; Q1–Q3): by line and quantity (and the shipping
 * left, if asked) or a custom amount of products before tax. The database sets every amount (tax and Daybell's fee pro
 * rata; the last refund takes the exact remainders) and refuses more than is left; then Stripe refunds the parent and
 * the studio's share is taken back from its transfer (lib/orders/refunds.ts). The same requestId again is the same
 * refund. 409 orders.feesPending with Retry-After until Stripe's fee is known. Owners and admins only; never staff.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanRefund(studio);
  assertFunctionRegion(studio.region);
  assertPayoutRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  const body = await parseBody(request, refundInput);
  const refundId = await startStudioRefund(studio.region, payments(), userId, studio.id, id, body);
  const order = await loadOrderDetail(supabase, studio, id);
  const refund = order.refunds?.find((r) => r.id === refundId);
  if (!refund) throw new ApiError("internal", "Something went wrong on our side.");
  return NextResponse.json({ refund }, { status: 201, headers: NO_STORE });
});
