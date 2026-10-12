import type { NoPhotosResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' data is handled in Montréal (D113; ADR 0016), like the other tagging routes.
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

interface Row {
  id: string;
  first_name: string;
  last_name: string;
  group_id: string | null;
  group_name: string | null;
}

/**
 * GET /api/v1/jobs/:id/tagging/no-photos — children with no photos yet (Seenu, answer 6), for a retake day later.
 * Children marked Do not photograph aren't missing anything. It doesn't block selling. Database only (no storage), like
 * the roster.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);
  const rows = (check(await supabase.rpc("tagging_no_photos", { p_job_id: jobId })) ?? []) as Row[];
  const body: NoPhotosResponse = {
    children: rows.map((r) => ({
      id: r.id,
      firstName: r.first_name,
      lastName: r.last_name,
      group: r.group_id ? { id: r.group_id, name: r.group_name ?? "" } : null,
    })),
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
