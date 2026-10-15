import { ApiError, fieldErrors, workerResultInput } from "@daybell/api";
import { after, NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { drmPackagingOn, requestDrm } from "@/lib/drm-packaging";
import { photoResult, workerResultRow } from "@/lib/photos";
import { pathId } from "@/lib/roster";
import { photoSystemRpc } from "@/lib/supabase/service";
import { tagBatchesOfPhotos } from "@/lib/tagging";
import { workerRequest } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/internal/photo-worker/photos/:id/result — the image worker's result (ADR 0016), with the QR card it read
 * (ADR 0018; the code is resolved within the photo's own job by the database and never logged). Idempotent: only a
 * photo being processed changes, so a repeated SQS message does nothing. Writes no event (D142 answer 1). Once a
 * batch's last photo is processed, the batch is tagged, after the response; a ready photo's large view is requested
 * for DRM packaging then too (ADR 0034: its proofs are new, so any earlier clip was dropped).
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const { region, body } = await workerRequest(request);
  const photoId = await pathId(ctx, "Photo not found.");
  let raw: unknown;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new ApiError("invalid_input", "The request body must be JSON.");
  }
  const parsed = workerResultInput.safeParse(raw);
  if (!parsed.success)
    throw new ApiError("invalid_input", "Please check what you sent.", fieldErrors(parsed.error));
  const recorded = photoResult<boolean>(
    await photoSystemRpc(region, "record_photo_result", {
      p_photo_id: photoId,
      p_attempt: parsed.data.attempt,
      p_result: workerResultRow(parsed.data),
    }),
  );
  if (recorded) after(() => tagBatchesOfPhotos(region, [photoId]));
  if (recorded && parsed.data.status === "ready" && drmPackagingOn(region))
    after(() => requestDrm(region, photoId));
  return NextResponse.json({ recorded });
});
