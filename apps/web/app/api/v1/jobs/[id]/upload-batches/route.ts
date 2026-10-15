import { type UploadBatchResponse, uploadBatchInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseOptionalBody } from "@/lib/api";
import { uploadBatchResult } from "@/lib/photo-groups";
import { assertCanUpload } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { loadRosterJob, pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
// Canadian studios' photos are handled in Montréal (D113; ADR 0016).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/jobs/:id/upload-batches — starts one drop of photos (D39; ADR 0016). Owners, admins and photographers
 * (Seenu, answer 6). Closed jobs refuse (D142 answer 2). The body is optional (D156; ADR 0030): individual photos by
 * default, split by their QR cards, with addToGroupId adding everyone they are given to to one of the job's groups
 * (add only, C7); { kind: "group", groupId } uploads group photos into one group, linked as their files are
 * registered. A group of another job (or studio) is 409 groups.notInJob, checked by the database.
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
  const batchId = uploadBatchResult<string>(
    await photoWriteRpc(studio.region, "create_upload_batch", userId, {
      p_job_id: jobId,
      p_kind: input.kind,
      p_photo_group_id: input.kind === "group" ? (input.groupId ?? null) : null,
      p_add_to_group_id: input.kind === "individual" ? (input.addToGroupId ?? null) : null,
    }),
  );
  const body: UploadBatchResponse = { batchId };
  return NextResponse.json(body, { status: 201 });
});
