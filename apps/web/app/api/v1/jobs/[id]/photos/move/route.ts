import { movePhotosInput, type PhotosMovedResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";
import { taggingResult, targetRow } from "@/lib/tagging";

export const runtime = "nodejs";
// Canadian studios' photos are handled in Montréal (D113; ADR 0016).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/photos/move — moves up to 500 of the job's photos by hand (Seenu, answer 7: drag, or select
 * and Move to…) to a child, a class's Class photo set or Leftovers. Owners, admins and photographers (answer 8; staff
 * read-only, plan answer 10). Moved photos keep their place when the upload is tagged again. One photos.moved event
 * with ids and a count.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, movePhotosInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const moved = taggingResult<number>(
    await photoWriteRpc(studio.region, "move_photos", userId, {
      p_job_id: jobId,
      p_photo_ids: input.photoIds,
      p_target: targetRow(input.target),
    }),
  );
  const body: PhotosMovedResponse = { moved };
  return NextResponse.json(body);
});
