import { confirmPhotosInput, type PhotosConfirmedResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";
import { taggingResult } from "@/lib/tagging";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/photos/confirm — confirms flagged photos at review (Seenu, plan answer 1): "Looks right" keeps
 * them where they are; "This is a card photo" (asCard) hides them from parents. Owners, admins and photographers. One
 * photos.confirmed event with ids and a count.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, confirmPhotosInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const confirmed = taggingResult<number>(
    await photoWriteRpc(studio.region, "confirm_photos", userId, {
      p_job_id: jobId,
      p_photo_ids: input.photoIds,
      p_as_card: input.asCard,
    }),
  );
  const body: PhotosConfirmedResponse = { confirmed };
  return NextResponse.json(body);
});
