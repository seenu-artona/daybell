import {
  type BulkOrderStatusResponse,
  bulkOrderStatusInput,
  ORDER_CONFLICTS,
  ORDER_DB_REFUSALS,
} from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { orderCheck } from "@/lib/orders/errors";
import { NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";
import { orderWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/orders/status — Mark printed, or Mark delivered to school, for up to 100 orders (ADR 0024; owners,
 * admins and staff). Each on its own: one refused doesn't stop the others; each result is "ok" or why.
 */
export const POST = handle(async (request: Request) => {
  const { studio, userId } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const body = await parseBody(request, bulkOrderStatusInput);
  const rows = orderCheck<{ order_id: string; outcome: string }[]>(
    await orderWriteRpc(studio.region, "mark_orders_status", userId, {
      p_studio_id: studio.id,
      p_order_ids: body.orderIds,
      p_status: body.status,
    }),
  );
  const outcome = (o: string) => {
    if (o === "ok" || o === "not_found") return o;
    const key = ORDER_DB_REFUSALS[o];
    return key ? ORDER_CONFLICTS[key] : ORDER_CONFLICTS.statusInvalid;
  };
  const result: BulkOrderStatusResponse = {
    results: rows.map((r) => ({ orderId: r.order_id, outcome: outcome(r.outcome) })),
  };
  return NextResponse.json(result, { headers: NO_STORE });
});
