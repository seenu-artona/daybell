import { priceListItemInput } from "@daybell/api";
import { isSingletonKind } from "@daybell/core";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  DIGITAL_TAKEN,
  itemPayload,
  linesPayload,
  loadItem,
  loadPriceListRow,
  pathId,
  priceListResult,
  toItem,
} from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/price-lists/:id/items — owners and admins add a package (with its contents), a print, the single
 * digital download or all digitals (Claude's call 2). One transaction through save_price_list_item, with row-level
 * security (SECURITY INVOKER).
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const input = await parseBody(request, priceListItemInput);
  await loadPriceListRow(supabase, studio.id, id);
  if (isSingletonKind(input.kind)) {
    const taken = check(
      await supabase
        .from("price_list_items")
        .select("id")
        .eq("studio_id", studio.id)
        .eq("price_list_id", id)
        .eq("kind", input.kind)
        .limit(1),
    );
    if (taken && taken.length > 0) throw DIGITAL_TAKEN();
  }
  const itemId = priceListResult<string>(
    await supabase.rpc("save_price_list_item", {
      p_price_list_id: id,
      p_item_id: null,
      p_item: itemPayload(input),
      p_lines: linesPayload(input.contents),
    }),
  );
  const saved = await loadItem(supabase, studio.id, itemId);
  return NextResponse.json({ item: toItem(saved.row, saved.currency) }, { status: 201 });
});
