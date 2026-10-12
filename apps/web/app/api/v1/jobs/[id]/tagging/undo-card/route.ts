import { type CardPhotosUndoneResponse, undoCardPhotosInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { assertFunctionRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { assertCanManage, studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";
import { taggingResult } from "@/lib/tagging";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/tagging/undo-card — undoes "This is a card photo" (Seenu, answer 12; ADR 0018): the photos go
 * back to Flagged (unreadableCard), hidden from parents until someone confirms them again. Owners and admins only
 * (photographers and staff get 403; the database checks again). One photos.card_unmarked event with ids and a count.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanManage(studio);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, undoCardPhotosInput);
  await loadRosterJob(supabase, studio.id, jobId);
  const undone = taggingResult<number>(
    await photoWriteRpc(studio.region, "undo_card_photos", userId, {
      p_job_id: jobId,
      p_photo_ids: input.photoIds,
    }),
  );
  const body: CardPhotosUndoneResponse = { undone };
  return NextResponse.json(body);
});
