import { ApiError, itemOrderInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { loadPriceListRow, pathId, priceListError } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PUT /api/v1/price-lists/:id/items/order — owners and admins put every item of the list in order (Move up / Move
 * down on the screen; no drag, WCAG 2.5.7). One price_list.reordered event, not one per item.
 */
export const PUT = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const { itemIds } = await parseBody(request, itemOrderInput);
  await loadPriceListRow(supabase, studio.id, id);
  const result = await supabase.rpc("set_price_list_item_order", {
    p_price_list_id: id,
    p_item_ids: itemIds,
  });
  if (result.error?.code === "22023")
    throw new ApiError("invalid_input", "Please check the highlighted fields.", {
      itemIds: "validation.itemOrder",
    });
  if (result.error) throw priceListError(result.error);
  return new NextResponse(null, { status: 204 });
});
