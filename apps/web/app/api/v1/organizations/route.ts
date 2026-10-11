import { organizationInput, organizationListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, filterValue, handle, likePattern, parseBody, parseQuery } from "@/lib/api";
import {
  ORGANIZATION_COLUMNS,
  type OrganizationRow,
  organizationColumns,
  page,
  toOrganization,
} from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

/** GET /api/v1/organizations — the studio's organizations by name, in pages; ?q= filters by name. */
export const GET = handle(async (request: Request) => {
  const { limit, cursor, q } = parseQuery(request, organizationListQuery);
  const { supabase, studio } = await studioScope();
  let query = supabase
    .from("organizations")
    .select(ORGANIZATION_COLUMNS)
    .eq("studio_id", studio.id)
    .order("name", { ascending: true })
    .order("id", { ascending: true })
    .limit(limit + 1);
  if (q) query = query.ilike("name", likePattern(q));
  if (cursor) {
    // Keyset pagination by (name, id). The cursor is an id, so names never travel in URLs or logs.
    const anchor = check(
      await supabase
        .from("organizations")
        .select("name")
        .eq("studio_id", studio.id)
        .eq("id", cursor)
        .maybeSingle(),
    ) as { name: string } | null;
    if (!anchor) return NextResponse.json({ organizations: [], nextCursor: null });
    const name = filterValue(anchor.name);
    query = query.or(`name.gt.${name},and(name.eq.${name},id.gt.${cursor})`);
  }
  const rows = (check(await query) ?? []) as OrganizationRow[];
  const { items, nextCursor } = page(rows, limit);
  return NextResponse.json({ organizations: items.map(toOrganization), nextCursor });
});

/** POST /api/v1/organizations — owners and admins add a school, daycare, club or league. */
export const POST = handle(async (request: Request) => {
  const input = await parseBody(request, organizationInput);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const row = check(
    await supabase
      .from("organizations")
      .insert({ studio_id: studio.id, ...organizationColumns(input) })
      .select(ORGANIZATION_COLUMNS)
      .single(),
  ) as OrganizationRow;
  return NextResponse.json({ organization: toOrganization(row) }, { status: 201 });
});
