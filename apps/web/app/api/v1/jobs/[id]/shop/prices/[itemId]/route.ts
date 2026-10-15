import { jobPriceInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  assertJobInStudio,
  assertListItemInStudio,
  jobShopResult,
  loadJobShop,
  shopPathIds,
} from "@/lib/job-shop";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * PATCH /api/v1/jobs/:id/shop/prices/:itemId — owners and admins change this job's price for a list item, or switch
 * it off (D157, N4). The list's price sent back clears the job's; the shared list never changes. The role is checked
 * before the body; the job and the item must be the studio's own (404); the database refuses a closed job and an item
 * no longer on the job's list (409). Answers with the whole shop.
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { jobId, itemId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const input = await parseBody(request, jobPriceInput);
  await assertJobInStudio(supabase, studio.id, jobId);
  await assertListItemInStudio(supabase, studio.id, itemId as string);
  jobShopResult(
    await supabase.rpc("set_job_price", {
      p_job_id: jobId,
      p_item_id: itemId,
      p_price_cents: input.priceCents ?? null,
      p_sold: input.sold ?? null,
    }),
  );
  return NextResponse.json({ shop: await loadJobShop(supabase, studio.id, jobId) });
});

/** DELETE /api/v1/jobs/:id/shop/prices/:itemId — Undo: the list's price applies again and the item is sold. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { jobId, itemId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await assertJobInStudio(supabase, studio.id, jobId);
  await assertListItemInStudio(supabase, studio.id, itemId as string);
  jobShopResult(await supabase.rpc("reset_job_price", { p_job_id: jobId, p_item_id: itemId }));
  return NextResponse.json({ shop: await loadJobShop(supabase, studio.id, jobId) });
});
