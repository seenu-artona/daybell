import { type RegisterFilesResponse, type UploadOutcome, uploadFilesInput } from "@daybell/api";
import { planParts } from "@daybell/core";
import { NextResponse } from "next/server";
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
 * POST /api/v1/upload-batches/:id/files — registers up to 500 files of a drop before they are uploaded (ADR 0016).
 * Filenames arrive in the body and go to the database only. Duplicates (same SHA-256 in the job) are skipped and
 * counted (Seenu, answer 5); a file still uploading resumes with its photo.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const batchId = await pathId(ctx, "Upload not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, uploadFilesInput);
  await loadBatch(supabase, studio.id, batchId);

  const rows = photoResult<{ index: number; outcome: UploadOutcome; photo_id: string | null }[]>(
    await photoWriteRpc(studio.region, "register_photos", userId, {
      p_batch_id: batchId,
      p_files: input.files.map((f) => ({ name: f.name, size: f.size, sha256: f.sha256 })),
    }),
  );
  const results: RegisterFilesResponse["results"] = rows.map((r) => {
    const { partSize, partCount } = planParts((input.files[r.index] as { size: number }).size);
    return { index: r.index, outcome: r.outcome, photoId: r.photo_id, partSize, partCount };
  });
  return NextResponse.json({ results });
});
