import { type JobProgressResponse, studioChecklistQuery } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseQuery } from "@/lib/api";
import { checklistToday } from "@/lib/checklist-facts";
import { loadJobRow } from "@/lib/jobs";
import { loadProgress } from "@/lib/progress";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/progress — the job's Progress for its Overview (D152; ADR 0029): six stages and their steps,
 * done from the job's checklist (D143), planned days from its rules, when from the event log, and who for owners and
 * admins only. Everyone on the team. Another studio's job is not found. `?today=` as on /jobs.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const id = await pathId(ctx, "Job not found.");
  const today = checklistToday(parseQuery(request, studioChecklistQuery).today);
  const { supabase, studio } = await studioScope();
  const row = await loadJobRow(supabase, studio.id, id);
  const body: JobProgressResponse = { progress: await loadProgress(supabase, studio, row, today) };
  return NextResponse.json(body);
});
