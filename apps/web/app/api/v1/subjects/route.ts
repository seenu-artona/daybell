import { subjectListQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseQuery } from "@/lib/api";
import { listSubjects } from "@/lib/people";
import { assertFunctionRegion } from "@/lib/region-guard";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Children's names with order data: Canadian studios' are read in Montréal (D113), like /orders and the roster.
export const preferredRegion = "yul1";

/**
 * GET /api/v1/subjects?show=&jobId=&clientId=&cursor=&limit= — every child across the studio's jobs (People ›
 * Subjects, D150), one row per child per job, by last and first name. Ordered (D148) for people who see orders only;
 * null for everyone else, who can't filter by it either. No text in the address: POST /subjects/search takes a name.
 */
export const GET = handle(async (request: Request) => {
  const query = parseQuery(request, subjectListQuery);
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  return NextResponse.json(await listSubjects(supabase, studio, query), {
    headers: { "Cache-Control": "no-store" },
  });
});
