import { after, NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { isLocalDriver, photoStorage, queuePhotoForProcessing } from "@/lib/photo-storage";
import { assertCanUpload, loadPhoto, photoResult, processLocally } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/photos/:id/retry — makes a photo's previews again: one the worker couldn't read, or one still
 * processing after 15 minutes (its message went to the dead-letter queue). The queue message holds the photo's id only
 * (D113).
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  await loadPhoto(supabase, studio.id, photoId);
  photoResult(await photoWriteRpc(studio.region, "retry_photo", userId, { p_photo_id: photoId }));
  if (isLocalDriver(studio.region)) {
    const storage = photoStorage(studio.region);
    after(() => processLocally(studio.region, storage, photoId));
  } else {
    await queuePhotoForProcessing(studio.region, photoId);
  }
  return NextResponse.json({ status: "processing" }, { status: 202 });
});
