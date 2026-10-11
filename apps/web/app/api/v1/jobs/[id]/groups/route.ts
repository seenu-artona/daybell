import { groupInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle, parseBody } from "@/lib/api";
import {
  GROUP_NAME_TAKEN,
  isGroupNameTaken,
  loadRosterJob,
  pathId,
  sortGroups,
} from "@/lib/roster";
import { assertCanEditRoster, studioScope } from "@/lib/studio";

type Ctx = { params: Promise<{ id: string }> };

/** GET /api/v1/jobs/:id/groups — the job's classes, teams or groups, with how many children each has. */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  await loadRosterJob(supabase, studio.id, jobId);
  const rows = (check(await supabase.rpc("list_job_groups", { p_job_id: jobId })) ?? []) as {
    id: string;
    name: string;
    child_count: number;
  }[];
  const groups = sortGroups(
    rows.map((r) => ({ id: r.id, name: r.name, childCount: Number(r.child_count) })),
  );
  return NextResponse.json({ groups });
});

/** POST /api/v1/jobs/:id/groups — owners, admins and photographers add a class, team or group. */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertCanEditRoster(studio);
  const input = await parseBody(request, groupInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const result = await supabase
    .from("job_groups")
    .insert({ studio_id: studio.id, job_id: jobId, name: input.name })
    .select("id, name")
    .single();
  if (isGroupNameTaken(result.error)) throw GROUP_NAME_TAKEN;
  const row = check(result) as { id: string; name: string };
  return NextResponse.json({ group: { ...row, childCount: 0 } }, { status: 201 });
});
