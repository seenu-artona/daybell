import { salesQuery } from "@daybell/api";
import { canSeeSales } from "@daybell/core";
import { NextResponse } from "next/server";
import { handle, parseQuery } from "@/lib/api";
import { orderCheck } from "@/lib/orders/errors";
import { NO_STORE } from "@/lib/orders/studio";
import { type DbSales, type DbTodo, toSales } from "@/lib/orders/views";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * GET /api/v1/studio/sales?tz= — Home's numbers (D127; ADR 0024): today, this week and this season, in the person's
 * time zone, from the ledger (owners and admins), and To do: orders waiting to print, ship or go to school (owners,
 * admins and staff; staff get To do only, Q4). Read as the person: row-level security decides.
 */
export const GET = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const { tz } = parseQuery(request, salesQuery);
  const [sales, todo] = await Promise.all([
    canSeeSales(studio.role)
      ? supabase.rpc("studio_sales", { p_studio_id: studio.id, p_tz: tz })
      : null,
    supabase.rpc("studio_order_todo", { p_studio_id: studio.id }),
  ]);
  return NextResponse.json(
    // An unknown time zone is the database's 22023: invalid input, not a failure.
    toSales(sales ? orderCheck<DbSales>(sales) : null, orderCheck<DbTodo>(todo)),
    { headers: NO_STORE },
  );
});
