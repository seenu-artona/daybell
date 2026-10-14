import { ApiError, orderListQuery } from "@daybell/api";
import { ORDER_DONE_STATUSES } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle, parseQuery } from "@/lib/api";
import { NO_STORE } from "@/lib/orders/studio";
import { type DbStudioOrder, toOrdersPage } from "@/lib/orders/views";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanSeeOrders, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' orders are read in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * GET /api/v1/orders?jobId=&status=&stage=&delivery=&q=&cursor=&limit= — the studio's paid orders, newest first, a
 * page at a time (ADR 0024): reference, date, children (first name and last initial), items, total, status, delivery
 * and the refund badge. Owners, admins and staff (Q4); the database's row-level security says so too. `q` is the start
 * of a reference only: names are never searched, and never in a URL. ?stage=done is Orders' Done chip (D147).
 * Every query is filtered by the studio.
 */
export const GET = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  assertCanSeeOrders(studio);
  assertFunctionRegion(studio.region);
  const { jobId, status, stage, delivery, q, limit, cursor } = parseQuery(request, orderListQuery);
  // One status, or a stage's statuses (D147: done is shipped, delivered or complete); never both.
  if (status && stage)
    throw new ApiError("invalid_input", "Please check the query parameters.", {
      stage: "validation.invalid",
    });
  const statuses = stage === "done" ? [...ORDER_DONE_STATUSES] : status ? [status] : null;
  if (jobId) {
    const job = check(
      await supabase
        .from("jobs")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("id", jobId)
        .maybeSingle(),
    );
    if (!job) throw new ApiError("not_found", "Job not found.");
  }
  const rows = check(
    await supabase.rpc("studio_orders", {
      p_studio_id: studio.id,
      p_job_id: jobId ?? null,
      p_statuses: statuses,
      p_reference: q ?? null,
      p_delivery: delivery ?? null,
      p_limit: limit + 1,
      p_cursor: cursor ?? null,
    }),
  ) as DbStudioOrder[];
  return NextResponse.json(toOrdersPage(rows, limit), { headers: NO_STORE });
});
