import type { JobShopResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadJobShop, shopPathIds } from "@/lib/job-shop";
import { studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/shop — what a job sells (D157): its price list with this job's own prices and Sold switches,
 * the products only it sells, and how many changes it has. Everyone on the team (photographers keep seeing prices,
 * N10). Prices and products are no personal data, so no region pin (ADR 0019's precedent).
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const { jobId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  const body: JobShopResponse = { shop: await loadJobShop(supabase, studio.id, jobId) };
  return NextResponse.json(body);
});
