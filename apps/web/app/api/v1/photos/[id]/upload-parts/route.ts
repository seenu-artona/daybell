import type { UploadPartsResponse } from "@daybell/api";
import { partLength, photoKey, planParts } from "@daybell/core";
import { StorageError } from "@daybell/storage";
import { after, NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import {
  assertCanUpload,
  INCOMPLETE,
  keyParts,
  recoverFinishedUpload,
  uploadingPhoto,
} from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * GET /api/v1/photos/:id/upload-parts — the parts storage already has whole, so an upload resumes where it stopped
 * (D39; ADR 0016). Resuming is driven by the server: nothing about the upload is kept in the browser. If the storage
 * upload was already completed (an earlier request stopped before marking the photo), the photo is marked uploaded
 * now and every part is reported present; if it was aborted, the photo is cancelled so the file can be dropped again
 * (review CR2).
 */
export const GET = handle(async (_request: Request, ctx: Ctx) => {
  const photoId = await pathId(ctx, "Photo not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const photo = await uploadingPhoto(supabase, studio, userId, photoId);
  const size = Number(photo.byte_size);
  const { partSize, partCount } = planParts(size);
  let parts: number[] = [];
  if (photo.upload_id) {
    const storage = photoStorage(studio.region);
    try {
      const stored = await storage.listParts(
        photoKey(keyParts(photo), "original"),
        photo.upload_id,
      );
      parts = stored
        .filter((p) => p.partNumber <= partCount && p.size === partLength(size, p.partNumber))
        .map((p) => p.partNumber);
    } catch (err) {
      if (!(err instanceof StorageError && err.code === "not_found")) throw err;
      if (!(await recoverFinishedUpload(studio.region, storage, userId, photo, after)))
        throw INCOMPLETE;
      parts = Array.from({ length: partCount }, (_, i) => i + 1);
    }
  }
  const body: UploadPartsResponse = { parts, partSize, partCount };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
});
