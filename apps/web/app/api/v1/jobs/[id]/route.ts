import { ApiError, type JobInput, jobPatch } from "@daybell/api";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { z } from "zod";
import { check, handle, parseBody } from "@/lib/api";
import {
  assertJobReferences,
  isNumberTaken,
  JOB_COLUMNS,
  type JobRow,
  jobColumns,
  NUMBER_TAKEN,
  toJob,
  validJob,
} from "@/lib/jobs";
import { assertCanManage, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

async function jobId(ctx: Ctx): Promise<string> {
  const { id } = await ctx.params;
  if (!z.uuid().safeParse(id).success) throw new ApiError("not_found", "Job not found.");
  return id;
}

async function loadJob(supabase: SupabaseClient, studioId: string, id: string): Promise<JobRow> {
  const row = check(
    await supabase
      .from("jobs")
      .select(JOB_COLUMNS)
      .eq("studio_id", studioId)
      .eq("id", id)
      .maybeSingle(),
  ) as unknown as JobRow | null;
  if (!row) throw new ApiError("not_found", "Job not found.");
  return row;
}

/** GET /api/v1/jobs/:id */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const id = await jobId(ctx);
  const { supabase, studio } = await studioScope();
  return NextResponse.json({ job: toJob(await loadJob(supabase, studio.id, id)) });
});

/** PATCH /api/v1/jobs/:id — owners and admins change a job's details. Status changes arrive in step 8. */
export const PATCH = handle(async (request: Request, ctx: Ctx) => {
  const id = await jobId(ctx);
  const patch = await parseBody(request, jobPatch);
  const { supabase, studio } = await studioScope();
  assertCanManage(studio);
  const current = await loadJob(supabase, studio.id, id);
  // The job as it will be, checked as a whole.
  const next = validJob({
    name: current.name,
    pictureDay: current.picture_day,
    clientId: current.client?.id ?? null,
    internalNumber: current.internal_number,
    type: current.type,
    categoryId: current.category.id,
    subjectsExpected: current.subjects_expected,
    ...patch,
  });
  await assertJobReferences(supabase, studio.id, {
    clientId: patch.clientId,
    categoryId: patch.categoryId,
  });
  const result = await supabase
    .from("jobs")
    .update(jobColumns(next, Object.keys(patch) as (keyof JobInput)[]))
    .eq("studio_id", studio.id)
    .eq("id", id)
    .select(JOB_COLUMNS)
    .maybeSingle();
  if (isNumberTaken(result.error)) throw NUMBER_TAKEN;
  const row = check(result) as unknown as JobRow | null;
  if (!row) throw new ApiError("not_found", "Job not found.");
  return NextResponse.json({ job: toJob(row) });
});
