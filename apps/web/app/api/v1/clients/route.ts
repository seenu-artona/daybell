import { clientInput, clientListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, filterValue, handle, likePattern, parseBody, parseQuery } from "@/lib/api";
import { CLIENT_COLUMNS, type ClientRow, clientColumns, page, toClient } from "@/lib/jobs";
import { withClientDetails } from "@/lib/people";
import { assertFunctionRegion } from "@/lib/region-guard";
import { assertCanManage, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Clients carry their main contact's name and email: Canadian studios' are read and written in Montréal (D113), like
// /contacts and /subjects (ADR 0028, call 8).
export const preferredRegion = "yul1";

/**
 * GET /api/v1/clients — the studio's clients by name, in pages; ?q= filters by name. Each with its main contact, job
 * count and latest job (People › Clients, D150), and how many clients match in all.
 */
export const GET = handle(async (request: Request) => {
  const { limit, cursor, q } = parseQuery(request, clientListQuery);
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  let query = supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("studio_id", studio.id)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (q) query = query.ilike("name", likePattern(q));
  let counting = supabase
    .from("clients")
    .select("id", { count: "exact", head: true })
    .eq("studio_id", studio.id);
  if (q) counting = counting.ilike("name", likePattern(q));
  if (cursor) {
    // Keyset pagination by (name, id). The cursor is an id, so names never travel in URLs or logs.
    const anchor = check(
      await supabase
        .from("clients")
        .select("name")
        .eq("studio_id", studio.id)
        .eq("id", cursor)
        .maybeSingle(),
    ) as { name: string } | null;
    // The cursor's client is gone (removed since the page before): no more pages, but the count still stands.
    if (!anchor) {
      const counted = await counting;
      check(counted);
      return NextResponse.json({ clients: [], nextCursor: null, total: counted.count ?? 0 });
    }
    const name = filterValue(anchor.name);
    query = query.or(`name.gt.${name},and(name.eq.${name},id.gt.${cursor})`);
  }
  const [rows, counted] = await Promise.all([query, counting]);
  const { items, nextCursor } = page((check(rows) ?? []) as ClientRow[], limit);
  check(counted);
  const clients = await withClientDetails(supabase, studio.id, items.map(toClient));
  return NextResponse.json({ clients, nextCursor, total: counted.count ?? 0 });
});

/** POST /api/v1/clients — owners and admins add a client. */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, clientInput);
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertCanManage(studio);
  const row = check(
    await supabase
      .from("clients")
      .insert({ studio_id: studio.id, ...clientColumns(input) })
      .select(CLIENT_COLUMNS)
      .single(),
  ) as ClientRow;
  return NextResponse.json({ client: toClient(row) }, { status: 201 });
});
