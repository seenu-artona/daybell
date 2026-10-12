import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { assertCanUpload, photoResult } from "@/lib/photos";
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
 * (Seenu, answer 6). Closed jobs refuse (D142 answer 2).
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const jobId = await pathId(ctx, "Job not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  await loadRosterJob(supabase, studio.id, jobId);
  const batchId = photoResult<string>(
    await photoWriteRpc(studio.region, "create_upload_batch", userId, { p_job_id: jobId }),
  );
  return NextResponse.json({ batchId }, { status: 201 });
});
