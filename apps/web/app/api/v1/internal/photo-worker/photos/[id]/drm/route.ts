import { ApiError, fieldErrors, workerDrmResultInput } from "@daybell/api";
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
 * POST /api/v1/internal/photo-worker/photos/:id/drm — the image worker's DRM clip for one packaging request (D158;
 * ADR 0034): the key ID and the content key as KMS wrapped it (never the key), or a permanent failure. Signed and capped
 * at 4 KB like the result route. A late or replayed result changes nothing. Logs only the photo's id and a fixed
 * reason; never the wrapped key. Writes no event (C5).
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
  const parsed = workerDrmResultInput.safeParse(raw);
  if (!parsed.success)
    throw new ApiError("invalid_input", "Please check what you sent.", fieldErrors(parsed.error));
  const result = parsed.data;
  if (result.status === "failed") {
    console.warn("drm_failed", photoId, result.reason);
    const recorded = photoResult<boolean>(
      await photoSystemRpc(region, "record_photo_drm_failed", {
        p_photo_id: photoId,
        p_attempt: result.attempt,
      }),
    );
    return NextResponse.json({ recorded });
  }
  const recorded = photoResult<boolean>(
    await photoSystemRpc(region, "record_photo_drm_result", {
      p_photo_id: photoId,
      p_attempt: result.attempt,
      p_key_id: result.keyId,
      // bytea, as PostgREST reads it: hex.
      p_wrapped_key: `\\x${Buffer.from(result.wrappedKey, "base64").toString("hex")}`,
      p_kms_key_arn: result.kmsKeyArn,
      p_width: result.width,
      p_height: result.height,
      p_bytes: result.bytes,
    }),
  );
  return NextResponse.json({ recorded });
});
