import { orderUndoInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
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
 * POST /api/v1/orders/:id/status/undo — one step back with a reason from the list (ADR 0024; owners and admins):
 * Printed → Paid, Shipped → Printed, Delivered → Printed.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanRefund(studio);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Order not found.");
  const body = await parseBody(request, orderUndoInput);
  orderCheck(
    await orderWriteRpc(studio.region, "undo_order_status", userId, {
      p_studio_id: studio.id,
      p_order_id: id,
      p_reason: body.reason,
    }),
  );
  return NextResponse.json(
    { order: await loadOrderDetail(supabase, studio, id) },
    { headers: NO_STORE },
  );
});
