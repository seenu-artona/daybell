import { uploadBatchInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseOptionalBody } from "@/lib/api";
import { assertCanUpload, photoResult } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { assertGroupInJob, loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Canadian studios' photos are handled in Montréal (D113; ADR 0016).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/upload-batches — starts one drop of photos (D39; ADR 0016). Owners, admins and photographers
 * (Seenu, answer 6). Closed jobs refuse (D142 answer 2). The body is optional: { groupId } makes it a class-photo upload
 * for one of the job's classes (Seenu, answer 3; ADR 0018).
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  // Read whatever was sent: a chunked or HTTP/2 body has no content-length (code review S1).
  const input = await parseOptionalBody(request, uploadBatchInput);
  await loadRosterJob(supabase, studio.id, jobId);
  await assertGroupInJob(supabase, studio.id, jobId, input.groupId);
  const batchId = photoResult<string>(
    await photoWriteRpc(studio.region, "create_upload_batch", userId, {
      p_job_id: jobId,
      ...(input.groupId ? { p_group_id: input.groupId } : {}),
    }),
  );
  return NextResponse.json({ batchId }, { status: 201 });
});
