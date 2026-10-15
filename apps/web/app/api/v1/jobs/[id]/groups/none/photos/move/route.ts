import { type GroupPhotosMovedResponse, moveGroupPhotosInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { groupResult } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { groupWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/groups/none/photos/move — puts group photos that are in no group into one of the job's groups
 * (C2). Every photo must be a group photo of the job in no group, the group the job's (groups.notInJob). Owners, admins
 * and photographers. One photo_group.photos_moved event, ids only.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, moveGroupPhotosInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const moved = groupResult<number>(
    await groupWriteRpc(studio.region, "move_group_photos", userId, {
      p_job_id: jobId,
      p_from: null,
      p_to: input.toGroupId,
      p_photo_ids: input.photoIds,
    }),
  );
  const body: GroupPhotosMovedResponse = { moved };
  return NextResponse.json(body);
});
