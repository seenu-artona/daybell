import { photoKey } from "@daybell/core";
import { handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { assertCanUpload, keyParts, photoResult, uploadingPhoto } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** DELETE /api/v1/photos/:id/upload — cancels a photo still uploading: its parts are dropped and the photo is gone. */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const photo = await uploadingPhoto(supabase, studio, userId, photoId);
  const uploadId = photoResult<string | null>(
    await photoWriteRpc(studio.region, "cancel_photo_upload", userId, { p_photo_id: photoId }),
  );
  if (uploadId)
    await photoStorage(studio.region).abort(photoKey(keyParts(photo), "original"), uploadId);
  return new Response(null, { status: 204 });
});
