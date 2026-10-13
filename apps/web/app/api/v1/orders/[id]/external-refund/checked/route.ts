import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { orderCheck } from "@/lib/orders/errors";
import { loadOrderDetail, NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { assertCanRefund, studioScope } from "@/lib/studio";
import { orderWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/orders/:id/external-refund/checked — an owner or admin has checked a refund made outside Daybell (the
 * Stripe Dashboard) with Stripe and the parent, so fulfilment may go on (ADR 0024; security review S5). 409
 * orders.statusInvalid when nothing is flagged or it was already checked.
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanRefund(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  orderCheck(
    await orderWriteRpc(studio.region, "check_external_refund", userId, {
      p_studio_id: studio.id,
      p_order_id: id,
    }),
  );
  return NextResponse.json(
    { order: await loadOrderDetail(supabase, studio, id) },
    { headers: NO_STORE },
  );
});
