import { ApiError, itemKindIssues, priceListItemPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  ITEM_NOT_FOUND,
  itemPayload,
  linesPayload,
  loadItem,
  pathId,
  priceListResult,
  toItem,
} from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * PATCH /api/v1/price-list-items/:id — owners and admins change an item in place, so its id stays stable for orders
 * (step 10); contents replace all of a package's contents. The kind never changes, and size and contents must suit it.
 * Orders already placed keep what they sold (answer 5).
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Item");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const patch = await parseBody(request, priceListItemPatch);
  const { row } = await loadItem(supabase, studio.id, id);
  const issues = itemKindIssues(row.kind, patch, false);
  if (issues.length > 0)
    throw new ApiError(
      "invalid_input",
      "Please check the highlighted fields.",
      Object.fromEntries(issues.map((i) => [i.path, i.message])),
    );
  priceListResult<string>(
    await supabase.rpc("save_price_list_item", {
      p_price_list_id: row.price_list_id,
      p_item_id: id,
      p_item: itemPayload(patch),
      p_lines: linesPayload(patch.contents),
    }),
  );
  const saved = await loadItem(supabase, studio.id, id);
  return NextResponse.json({ item: toItem(saved.row, saved.currency) });
});

/** DELETE /api/v1/price-list-items/:id — owners and admins remove an item; orders already placed keep what they sold. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Item");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const rows = check(
    await supabase
      .from("price_list_items")
      .delete()
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select("id"),
  );
  if (!rows || rows.length === 0) throw ITEM_NOT_FOUND();
  return new NextResponse(null, { status: 204 });
});
