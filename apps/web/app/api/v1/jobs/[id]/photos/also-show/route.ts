import { alsoShowPhotosInput, type PhotosShownResponse } from "@daybell/api";
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
 * POST /api/v1/jobs/:id/photos/also-show — Also show in… (D156): adds up to 500 of the job's group photos to up to 500
 * of its groups; groups already showing a photo are skipped (links only added). A person's photo, or another job's
 * photo or group, is groups.notInJob. Owners, admins and photographers. One photo_group.photos_shown event, ids only.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, alsoShowPhotosInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const added = groupResult<number>(
    await groupWriteRpc(studio.region, "also_show_photos", userId, {
      p_job_id: jobId,
      p_photo_ids: input.photoIds,
      p_group_ids: input.groupIds,
    }),
  );
  const body: PhotosShownResponse = { added };
  return NextResponse.json(body);
});
