import { photoIdsInput } from "@daybell/api";
import { after, NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { assertCanUpload, photoResult } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";
import { tagBatchesOfPhotos } from "@/lib/tagging";

export const runtime = "nodejs";
// Canadian studios' photos are handled in Montréal (D113; ADR 0016).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/photos/bin — moves up to 500 of the job's photos to the bin (Seenu, answer 7). Binned photos
 * are deleted for good after 30 days by the daily clean-up. A photo that has sold can't be binned (nothing moves).
 * One event for the lot, with the photos' ids and a count (D142 answer 1).
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, photoIdsInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const moved = photoResult<number>(
    await photoWriteRpc(studio.region, "bin_photos", userId, {
      p_job_id: jobId,
      p_photo_ids: input.photoIds,
    }),
  );
  // Their batches are tagged again without them, or with them back (ADR 0018).
  if (moved > 0) after(() => tagBatchesOfPhotos(studio.region, input.photoIds));
  return NextResponse.json({ moved });
});
