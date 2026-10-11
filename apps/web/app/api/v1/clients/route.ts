import { clientInput, clientListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, filterValue, handle, likePattern, parseBody, parseQuery } from "@/lib/api";
import { CLIENT_COLUMNS, type ClientRow, clientColumns, page, toClient } from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** GET /api/v1/clients — the studio's clients by name, in pages; ?q= filters by name. */
export const GET = handle(async (request: Request) => {
  const { limit, cursor, q } = parseQuery(request, clientListQuery);
  const { supabase, studio } = await studioScope();
  let query = supabase
    .from("clients")
    .select(CLIENT_COLUMNS)
    .eq("studio_id", studio.id)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (q) query = query.ilike("name", likePattern(q));
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
    if (!anchor) return NextResponse.json({ clients: [], nextCursor: null });
    const name = filterValue(anchor.name);
    query = query.or(`name.gt.${name},and(name.eq.${name},id.gt.${cursor})`);
  }
  const rows = (check(await query) ?? []) as ClientRow[];
  const { items, nextCursor } = page(rows, limit);
  return NextResponse.json({ clients: items.map(toClient), nextCursor });
});

/** POST /api/v1/clients — owners and admins add a client. */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, clientInput);
  const { supabase, studio } = await studioScope();
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
