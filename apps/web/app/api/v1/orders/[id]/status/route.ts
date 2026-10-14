import { orderStatusInput } from "@daybell/api";
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
 * POST /api/v1/orders/:id/status — Printed, Shipped (home, with a carrier and tracking number) or Delivered to school
 * (ADR 0024; answer 4: owners, admins and staff). The database acts for the person, checks their role again and the
 * step; refusals are 409 with an orders.* code. Answers the order as it is now.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  const body = await parseBody(request, orderStatusInput);
  orderCheck(
    await orderWriteRpc(studio.region, "mark_order_status", userId, {
      p_studio_id: studio.id,
      p_order_id: id,
      p_status: body.status,
      p_carrier: body.status === "shipped" ? body.carrier : null,
      p_tracking_number: body.status === "shipped" ? body.trackingNumber : null,
      p_tracking_url: body.status === "shipped" ? body.trackingUrl : null,
    }),
  );
  return NextResponse.json(
    { order: await loadOrderDetail(supabase, studio, id) },
    { headers: NO_STORE },
  );
});
