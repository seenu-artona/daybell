import { partsComplete, photoKey, photoPrefix } from "@daybell/core";
import { after, NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { isLocalDriver, photoStorage } from "@/lib/photo-storage";
import {
  assertCanUpload,
  INCOMPLETE,
  keyParts,
  photoResult,
  processLocally,
  uploadingPhoto,
} from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";
// Completing a 50 MB upload takes S3 a few seconds at most.
export const maxDuration = 60;

type Ctx = { params: Promise<{ id: string }> };

/**
 * POST /api/v1/photos/:id/upload-complete — finishes a photo's upload (ADR 0016). No body: the server asks storage
 * for the parts itself (never trusting the browser's list), checks every part is there at its exact length, completes
 * the upload and checks the stored size. A wrong size deletes the object and fails the photo, so the file can be
 * dropped again. Otherwise the photo moves to processing: S3's event queues it for the image worker (in Canada); with
 * the local driver it is processed here after the response.
 */
export const POST = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const photo = await uploadingPhoto(supabase, studio, userId, photoId);
  if (!photo.upload_id) throw INCOMPLETE;

  const storage = photoStorage(studio.region);
  const key = photoKey(keyParts(photo), "original");
  const size = Number(photo.byte_size);
  const parts = await storage.listParts(key, photo.upload_id);
  if (!partsComplete(size, parts)) throw INCOMPLETE;
  await storage.complete(key, photo.upload_id, parts);

  const stored = await storage.head(key);
  if (stored?.size !== size) {
    // Never kept: an object that isn't what was registered.
    await storage.deleteAllVersions(photoPrefix(keyParts(photo)));
    photoResult(
      await photoWriteRpc(studio.region, "mark_photo_uploaded", userId, {
        p_photo_id: photoId,
        p_failure: "incomplete",
      }),
    );
    console.error("photo_size_mismatch", photoId);
    return NextResponse.json({ status: "failed" });
  }
  photoResult(
    await photoWriteRpc(studio.region, "mark_photo_uploaded", userId, { p_photo_id: photoId }),
  );
  if (isLocalDriver(studio.region)) after(() => processLocally(studio.region, storage, photoId));
  return NextResponse.json({ status: "processing" });
});
