import { jobItemInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  assertJobInStudio,
  jobItemPayload,
  jobShopResult,
  loadJobShop,
  shopPathIds,
} from "@/lib/job-shop";
import { linesPayload } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/shop/items — owners and admins add a package or a print only this job sells (D157, B2), in one
 * transaction with its contents. At most 100 per job; not on a closed job. Answers with the whole shop.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { jobId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const input = await parseBody(request, jobItemInput);
  await assertJobInStudio(supabase, studio.id, jobId);
  jobShopResult(
    await supabase.rpc("save_job_item", {
      p_job_id: jobId,
      p_item_id: null,
      p_item: jobItemPayload(input),
      p_lines: linesPayload(input.contents),
    }),
  );
  return NextResponse.json(
    { shop: await loadJobShop(supabase, studio.id, jobId) },
    { status: 201 },
  );
});
