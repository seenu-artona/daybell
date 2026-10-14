import { orderTrackingInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { orderCheck } from "@/lib/orders/errors";
import { loadOrderDetail, NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";
import { orderWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/orders/:id/tracking — corrects a shipped order's carrier, tracking number or link (ADR 0024; owners,
 * admins and staff). The number never goes in an event or a log.
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  const body = await parseBody(request, orderTrackingInput);
  orderCheck(
    await orderWriteRpc(studio.region, "set_order_tracking", userId, {
      p_studio_id: studio.id,
      p_order_id: id,
      p_carrier: body.carrier,
      p_tracking_number: body.trackingNumber,
      p_tracking_url: body.trackingUrl,
    }),
  );
  return NextResponse.json(
    { order: await loadOrderDetail(supabase, studio, id) },
    { headers: NO_STORE },
  );
});
