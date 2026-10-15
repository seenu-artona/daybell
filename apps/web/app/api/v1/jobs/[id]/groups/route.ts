import type { PhotoGroupResponse, PhotoGroupsResponse } from "@daybell/api";
import { photoGroupInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { groupResult, readPhotoGroup, readPhotoGroups } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Groups name the job's people: Canadian studios' are handled in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/jobs/:id/groups — the job's photo groups (D156; ADR 0030) by name: members, group photos and Ordered (C16:
 * owners and admins only, null for everyone else), and how many group photos are in no group (C2). Everyone on the
 * team may look; row-level security keeps it to the caller's studio.
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio } = await studioScope();
  assertFunctionRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);
  const body: PhotoGroupsResponse = await readPhotoGroups(supabase, jobId);
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});

/**
 * POST /api/v1/jobs/:id/groups — + New group. Owners, admins and photographers (C11), checked before the body is read
 * and again by the database. Names are unique per job ignoring case (groups.nameTaken), at most 500 groups (groups.limit),
 * not in a closed job (groups.jobClosed). One photo_group.created event, ids only.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, photoGroupInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const id = groupResult<string>(
    await groupWriteRpc(studio.region, "create_photo_group", userId, {
      p_job_id: jobId,
      p_name: input.name,
    }),
  );
  const body: PhotoGroupResponse = { group: await readPhotoGroup(supabase, jobId, id) };
  return NextResponse.json(body, { status: 201 });
});
