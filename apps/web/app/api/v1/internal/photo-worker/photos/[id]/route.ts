import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoResult } from "@/lib/photos";
import { pathId } from "@/lib/roster";
import { photoSystemRpc } from "@/lib/supabase/service";
import { workerRequest } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/internal/photo-worker/photos/:id — what the image worker needs to make a photo's previews (ADR 0016):
 * ids, the expected hash and size, the status, and the studio's name for the watermark (Seenu, answer 4). Never the
 * filename. With the DRM packaging request's status and attempt (ADR 0034). HMAC-signed requests only; the region comes
 * from the signed Daybell-Region header.
 */
export const GET = handle(async (request: Request, ctx: Ctx) => {
  const { region } = await workerRequest(request);
  const photoId = await pathId(ctx, "Photo not found.");
  const row = photoResult<{
    id: string;
    studio_id: string;
    job_id: string;
    status: string;
    sha256: string;
    byte_size: number;
    attempt: number;
    studio_name: string;
    drm_status?: "requested" | "ready" | "failed" | null;
    drm_attempt?: number;
  } | null>(await photoSystemRpc(region, "photo_for_worker", { p_photo_id: photoId }));
  if (!row) throw new ApiError("not_found", "Photo not found.");
  return NextResponse.json(
    {
      photo: {
        id: row.id,
        studioId: row.studio_id,
        jobId: row.job_id,
        status: row.status,
        sha256: row.sha256,
        byteSize: Number(row.byte_size),
        attempt: Number(row.attempt),
        studioName: row.studio_name,
        // The large view's DRM packaging request (ADR 0034).
        drmStatus: row.drm_status ?? null,
        drmAttempt: Number(row.drm_attempt ?? 0),
      },
    },
    { headers: { "cache-control": "no-store" } },
  );
});
