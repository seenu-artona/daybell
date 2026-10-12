import { ApiError, type PriceListsResponse, priceListInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { loadPriceList, loadSummaries, priceListResult } from "@/lib/price-lists";
import { assertCanManage, studioScope } from "@/lib/studio";

/**
 * GET /api/v1/price-lists — the studio's price lists (ADR 0019), the default first, with item counts and usage. Every
 * member reads them (answer 8). Database only, so it runs where the rest of the API does (D113).
 */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  const body: PriceListsResponse = { priceLists: await loadSummaries(supabase, studio.id) };
  return NextResponse.json(body);
});

/**
 * POST /api/v1/price-lists — owners and admins add a list: blank, or a copy of one of the studio's lists (Claude's
 * call 2). The person and their role are checked before the body is read. The database sets the currency from the
 * studio's region and holds the 50-list limit.
 */
export const POST = handle(async (request: Request) => {
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const input = await parseBody(request, priceListInput);
  let id: string;
  if (input.copyFromId) {
    // copy_price_list only sees the caller's own studio's lists (row-level security), so another studio's is unknown.
    const copied = await supabase.rpc("copy_price_list", {
      p_source_id: input.copyFromId,
      p_name: input.name,
    });
    if (copied.error?.code === "P0002")
      throw new ApiError("invalid_input", "Please check the highlighted fields.", {
        copyFromId: "validation.priceList",
      });
    id = priceListResult<string>(copied);
  } else {
    const row = priceListResult<{ id: string }>(
      await supabase
        .from("price_lists")
        .insert({ studio_id: studio.id, name: input.name })
        .select("id")
        .single(),
    );
    id = row.id;
  }
  return NextResponse.json(
    { priceList: await loadPriceList(supabase, studio.id, id) },
    { status: 201 },
  );
});
