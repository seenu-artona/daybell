import { subjectSearchInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { listSubjects } from "@/lib/people";
import { assertFunctionRegion } from "@/lib/region-guard";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// As GET /subjects: Canadian studios' children are read in Montréal (D113).
export const preferredRegion = "yul1";

/**
 * POST /api/v1/subjects/search — GET /subjects with part of a child's name. The text arrives in the body and goes to the
 * database as an RPC argument, so it never appears in a URL or request log, and it is never logged here (D113).
 */
export const POST = handle(async (request: Request) => {
  // Who is asking comes first, before the body is read (S4).
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  const query = await parseBody(request, subjectSearchInput);
  return NextResponse.json(await listSubjects(supabase, studio, query), {
    headers: { "Cache-Control": "no-store" },
  });
});
