import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { loadPriceListRow, pathId } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/price-lists/:id/default — owners and admins make one of the studio's lists the default (answer 1): new
 * jobs get it, existing jobs keep theirs. The studio's composite FK keeps the default inside the studio.
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await loadPriceListRow(supabase, studio.id, id);
  check(await supabase.from("studios").update({ default_price_list_id: id }).eq("id", studio.id));
  return new NextResponse(null, { status: 204 });
});
