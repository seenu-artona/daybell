import { ApiError, orderListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { type DbStudioOrder, toOrdersPage } from "@/lib/checkout/orders";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' orders are read in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * GET /api/v1/orders?jobId= — a job's paid orders, newest first, a page at a time (ADR 0023): reference, children,
 * items, tax, Daybell's fee and the rate it used, Stripe's card fee and what reaches the studio (D98). Owners and admins
 * until fulfilment (call 15); the database's row-level security says so too. Every query is filtered by the studio.
 */
export const GET = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  assertCanSeePayouts(studio);
  assertFunctionRegion(studio.region);
  const { jobId, limit, cursor } = parseQuery(request, orderListQuery);
  const job = check(
    await supabase
      .from("jobs")
      .select("id")
      .eq("studio_id", studio.id)
      .eq("id", jobId)
      .maybeSingle(),
  );
  if (!job) throw new ApiError("not_found", "Job not found.");
  const rows = check(
    await supabase.rpc("job_orders", {
      p_studio_id: studio.id,
      p_job_id: jobId,
      p_limit: limit + 1,
      p_cursor: cursor ?? null,
    }),
  ) as DbStudioOrder[];
  return NextResponse.json(toOrdersPage(rows, limit), {
    headers: { "cache-control": "private, no-store" },
  });
});
