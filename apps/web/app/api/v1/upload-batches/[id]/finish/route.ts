import { finishBatchInput } from "@daybell/api";
import { handle, parseBody } from "@/lib/api";
import { assertCanUpload, loadBatch, photoResult } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/upload-batches/:id/finish — ends a drop: one event for the job's activity with counts only (D142
 * answer 1). Finishing twice changes nothing.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const batchId = await pathId(ctx, "Upload not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, finishBatchInput);
  await loadBatch(supabase, studio.id, batchId);
  photoResult(
    await photoWriteRpc(studio.region, "finish_upload_batch", userId, {
      p_batch_id: batchId,
      p_files_skipped: input.skipped,
      p_duplicates: input.duplicates,
    }),
  );
  return new Response(null, { status: 204 });
});
