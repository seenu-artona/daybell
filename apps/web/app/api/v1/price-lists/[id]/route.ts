import { type PriceListResponse, priceListPatch } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  IN_USE,
  IS_DEFAULT,
  LIST_NOT_FOUND,
  loadPriceList,
  loadPriceListRow,
  loadSummaries,
  pathId,
  priceListError,
  priceListResult,
} from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/price-lists/:id — one of the studio's lists, every item in position order (ADR 0019). */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  const body: PriceListResponse = { priceList: await loadPriceList(supabase, studio.id, id) };
  return NextResponse.json(body);
});

/**
 * PATCH /api/v1/price-lists/:id — owners and admins rename a list or change its home shipping fee. A selling job's
 * list may change: new orders use the new prices, orders already placed keep theirs (answer 5).
 */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const patch = await parseBody(request, priceListPatch);
  const row = priceListResult<{ id: string } | null>(
    await supabase
      .from("price_lists")
      .update({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.homeShippingCents !== undefined
          ? { home_shipping_cents: patch.homeShippingCents }
          : {}),
      })
      .eq("studio_id", studio.id)
      .eq("id", id)
      .select("id")
      .maybeSingle(),
  );
  if (!row) throw LIST_NOT_FOUND();
  return NextResponse.json({ priceList: await loadPriceList(supabase, studio.id, id) });
});

/**
 * DELETE /api/v1/price-lists/:id — owners and admins delete a list that isn't the default and that no job uses
 * (Claude's call 2). The database refuses both too; checking first gives a named 409.
 */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Price list");
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  await loadPriceListRow(supabase, studio.id, id);
  const [summary] = await loadSummaries(supabase, studio.id, id);
  if (summary?.isDefault) throw IS_DEFAULT();
  if ((summary?.jobs ?? 0) > 0) throw IN_USE();
  const result = await supabase
    .from("price_lists")
    .delete()
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select("id");
  // A job (or the default) took the list between the check and the delete.
  if (result.error?.code === "23503") throw IN_USE();
  if (result.error) throw priceListError(result.error);
  if (check(result).length === 0) throw LIST_NOT_FOUND();
  return new NextResponse(null, { status: 204 });
});
