import type { JobSalesResponse } from "@daybell/api";
import { ApiError } from "@daybell/api";
import { type Currency, canSeeSales } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { loadJobRow } from "@/lib/jobs";
import { NO_STORE } from "@/lib/orders/studio";
import { assertFunctionRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// A job's numbers come from its orders: Canadian studios' are worked out in Montréal (D113, D152).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

interface DbJobSales {
  currency: Currency;
  sales_cents: number | string;
  orders: number | string;
  first_paid_at: string | null;
  subjects: number | string;
  subjects_ordered: number | string;
}

/**
 * GET /api/v1/jobs/:id/sales — a job's Sales and Subjects ordered (D152; ADR 0029): sales by Home's rule (what parents
 * paid less refunds, from the ledger) for the paid orders with a line in the job, how many orders, and how many of
 * everyone on the roster has ordered (D148). Owners and admins only; the database refuses anyone else too. Read as the
 * person, in Montréal for Canadian studios, before anything is read.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  if (!canSeeSales(studio.role))
    throw new ApiError("forbidden", "Only owners and admins can see a job's numbers.");
  assertFunctionRegion(studio.region);
  await loadJobRow(supabase, studio.id, id);
  const row = check(
    await supabase.rpc("job_sales", { p_studio_id: studio.id, p_job_id: id }),
  ) as DbJobSales;
  const body: JobSalesResponse = {
    sales: {
      currency: row.currency,
      salesCents: Number(row.sales_cents),
      orders: Number(row.orders),
      firstPaidAt: row.first_paid_at,
      subjects: Number(row.subjects),
      subjectsOrdered: Number(row.subjects_ordered),
    },
  };
  return NextResponse.json(body, { headers: NO_STORE });
});
