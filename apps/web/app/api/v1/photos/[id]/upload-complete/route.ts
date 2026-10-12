import { ApiError } from "@daybell/api";
import { partsComplete, photoKey, photoPrefix } from "@daybell/core";
import { StorageError } from "@daybell/storage";
import { after, NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import {
  assertCanUpload,
  INCOMPLETE,
  keyParts,
  loadPhoto,
  markUploaded,
  photoResult,
  recoverFinishedUpload,
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

const isGone = (err: unknown) => err instanceof StorageError && err.code === "not_found";

/**
 * POST /api/v1/photos/:id/upload-complete — finishes a photo's upload (ADR 0016). No body: the server asks storage
 * for the parts itself (never trusting the browser's list), checks every part is there at its exact length, completes
 * the upload and checks the stored size. A wrong size deletes the object and fails the photo, so the file can be
 * dropped again. Otherwise the photo moves to processing: S3's event queues it for the image worker (in Canada); with
 * the local driver it is processed here after the response. If an earlier request already completed the upload but
 * didn't get as far as marking it, the stored original is checked and the photo marked now (review CR2). If the photo
 * was cancelled meanwhile, the stored object is deleted (review CR3).
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
  const recover = async () => {
    if (await recoverFinishedUpload(studio.region, storage, userId, photo, after))
      return NextResponse.json({ status: "processing" });
    throw INCOMPLETE;
  };

  let parts: Awaited<ReturnType<typeof storage.listParts>>;
  try {
    parts = await storage.listParts(key, photo.upload_id);
  } catch (err) {
    if (isGone(err)) return recover();
    throw err;
  }
  if (!partsComplete(size, parts)) throw INCOMPLETE;
  try {
    await storage.complete(key, photo.upload_id, parts);
  } catch (err) {
    if (isGone(err)) return recover();
    throw err;
  }

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
  try {
    await markUploaded(studio.region, storage, userId, photoId, { requeue: false, after });
  } catch (err) {
    // Cancelled (or purged) while completing: the object has no photo, so it goes too.
    const gone = await loadPhoto(supabase, studio.id, photoId).then(
      () => false,
      (e: unknown) => e instanceof ApiError && e.code === "not_found",
    );
    if (gone) await storage.deleteAllVersions(photoPrefix(keyParts(photo)));
    throw err;
  }
  return NextResponse.json({ status: "processing" });
});
