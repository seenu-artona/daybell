import { ApiError, fieldErrors, workerResultInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoResult, workerResultRow } from "@/lib/photos";
import { pathId } from "@/lib/roster";
import { photoSystemRpc } from "@/lib/supabase/service";
import { workerRequest } from "@/lib/worker-auth";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/internal/photo-worker/photos/:id/result — the image worker's result (ADR 0016). Idempotent: only a
 * photo being processed changes, so a repeated SQS message does nothing. Writes no event (D142 answer 1).
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
  return NextResponse.json({ recorded });
});
