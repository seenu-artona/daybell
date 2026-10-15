import { ApiError, itemKindIssues, jobItemPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  assertJobInStudio,
  jobItemPayload,
  jobShopResult,
  loadJobItemKind,
  loadJobShop,
  shopPathIds,
} from "@/lib/job-shop";
import { linesPayload } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string; itemId: string }> };

/**
 * PATCH /api/v1/jobs/:id/shop/items/:itemId — owners and admins change a product only this job sells, or switch it off
 * (D157, B2). It keeps its id (orders point at it) and its kind; contents replace all of a package's. Answers with
 * the whole shop.
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const { jobId, itemId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const patch = await parseBody(request, jobItemPatch);
  await assertJobInStudio(supabase, studio.id, jobId);
  const kind = await loadJobItemKind(supabase, studio.id, jobId, itemId as string);
  const issues = itemKindIssues(kind, patch, false);
  if (issues.length > 0)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      Object.fromEntries(issues.map((i) => [i.path, i.message])),
    );
  jobShopResult(
    await supabase.rpc("save_job_item", {
      p_job_id: jobId,
      p_item_id: itemId,
      p_item: jobItemPayload(patch),
      p_lines: linesPayload(patch.contents),
    }),
  );
  return NextResponse.json({ shop: await loadJobShop(supabase, studio.id, jobId) });
});

/** DELETE /api/v1/jobs/:id/shop/items/:itemId — owners and admins remove one; orders already placed keep it. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { jobId, itemId } = await shopPathIds(ctx);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await assertJobInStudio(supabase, studio.id, jobId);
  await loadJobItemKind(supabase, studio.id, jobId, itemId as string);
  jobShopResult(await supabase.rpc("delete_job_item", { p_job_id: jobId, p_item_id: itemId }));
  return NextResponse.json({ shop: await loadJobShop(supabase, studio.id, jobId) });
});
