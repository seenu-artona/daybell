import { type SearchResponse, searchInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { studioScope } from "@/lib/studio";

interface SearchRow {
  jobs: {
    id: string;
    name: string;
    internal_number: string;
    status: SearchResponse["jobs"][number]["status"];
    picture_day: string;
  }[];
  clients: { id: string; name: string; city: string | null }[];
}

/**
 * POST /api/v1/search — the menu search box (D138; ADR 0013). Any member searches their own studio's jobs (name or
 * number) and clients (name); never children. The text arrives in the body and goes to the database as an RPC
 * argument, so it never appears in a URL or request log, and it is never logged here.
 */
export const POST = handle(async (request: Request) => {
  // Who is asking comes first, before the body is read (S4).
  const { supabase, studio } = await studioScope();
  const { q } = await parseBody(request, searchInput);
  const found = check(
    await supabase.rpc("search_studio", { p_studio_id: studio.id, p_query: q }),
  ) as SearchRow | null;
  const body: SearchResponse = {
    jobs: (found?.jobs ?? []).map((j) => ({
      id: j.id,
      name: j.name,
      internalNumber: j.internal_number,
      status: j.status,
      pictureDay: j.picture_day,
    })),
    clients: (found?.clients ?? []).map((c) => ({ id: c.id, name: c.name, city: c.city })),
  };
  return NextResponse.json(body);
});
