import { type ClassesResponse, type ClassResponse, classInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import {
  CLASS_NAME_TAKEN,
  isClassNameTaken,
  loadRosterJob,
  pathId,
  sortClasses,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Names and classes of a Canadian studio's children are handled in Montréal (D113), like the rest of the roster.
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/classes — the job's classes (or teams), a roster field (C1), with how many children each has.
 * Classes are job_groups in the database; photo groups are /jobs/:id/groups (C6; ADR 0030).
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);
  const rows = (check(await supabase.rpc("list_job_groups", { p_job_id: jobId })) ?? []) as {
    id: string;
    name: string;
    child_count: number;
  }[];
  const body: ClassesResponse = {
    classes: sortClasses(
      rows.map((r) => ({ id: r.id, name: r.name, childCount: Number(r.child_count) })),
    ),
  };
  return NextResponse.json(body);
});

/** POST /api/v1/jobs/:id/classes — owners, admins and photographers add a class. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  assertCanEditRoster(studio);
  const input = await parseBody(request, classInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const result = await supabase
    .from("job_groups")
    .insert({ studio_id: studio.id, job_id: jobId, name: input.name })
    .select("id, name")
    .single();
  if (isClassNameTaken(result.error)) throw CLASS_NAME_TAKEN;
  const row = check(result) as { id: string; name: string };
  const body: ClassResponse = { class: { ...row, childCount: 0 } };
  return NextResponse.json(body, { status: 201 });
});
