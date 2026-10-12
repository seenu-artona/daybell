import { ApiError, type PartUrlsResponse, partUrlsInput } from "@daybell/api";
import { partLength, photoKey } from "@daybell/core";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import { photoStorage } from "@/lib/photo-storage";
import { assertCanUpload, loadBatch, photoResult, type UploadingPhoto } from "@/lib/photos";
import { assertFunctionRegion, assertStorageRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { studioScope } from "@/lib/studio";
import { photoWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/** Part URLs last 15 minutes: long enough for a slow 8 MiB part, short enough to be useless if leaked. */
const PART_URL_SECONDS = 15 * 60;

/**
 * POST /api/v1/upload-batches/:id/part-urls — signed URLs for parts of photos still uploading in the batch's job (ADR
 * 0016). Starts each photo's storage upload on first use; if two requests race, the first upload id is kept and the
 * other is aborted. Each URL carries the part's exact length.
 */
export const POST = handle(async (request: Request, ctx: Ctx) => {
  const batchId = await pathId(ctx, "Upload not found.");
  const { supabase, studio, userId } = await studioScope();
  assertCanUpload(studio);
  assertFunctionRegion(studio.region);
  assertStorageRegion(studio.region);
  const input = await parseBody(request, partUrlsInput);
  const batch = await loadBatch(supabase, studio.id, batchId);

  const photos = photoResult<UploadingPhoto[]>(
    await photoWriteRpc(studio.region, "photos_uploading", userId, {
      p_photo_ids: input.items.map((i) => i.photoId),
    }),
  ).filter((p) => p.studio_id === studio.id && p.job_id === batch.job_id);
  const byId = new Map(photos.map((p) => [p.id, p]));
  if (input.items.some((i) => !byId.has(i.photoId)))
    throw new ApiError("conflict", "Some of these photos aren't uploading.", {
      form: "photos.notUploading",
    });

  const storage = photoStorage(studio.region);
  const urls: PartUrlsResponse["urls"] = [];
  for (const item of input.items) {
    const photo = byId.get(item.photoId) as UploadingPhoto;
    const key = photoKey(
      { studioId: photo.studio_id, jobId: photo.job_id, photoId: photo.id },
      "original",
    );
    let uploadId = photo.upload_id;
    if (!uploadId) {
      const started = await storage.createMultipart(key, "image/jpeg");
      uploadId = photoResult<string>(
        await photoWriteRpc(studio.region, "set_photo_upload_id", userId, {
          p_photo_id: photo.id,
          p_upload_id: started,
        }),
      );
      if (uploadId !== started) await storage.abort(key, started);
    }
    for (const partNumber of item.partNumbers) {
      let length: number;
      try {
        length = partLength(Number(photo.byte_size), partNumber);
      } catch {
        throw new ApiError("invalid_input", "Please check what you sent.", {
          items: "validation.invalid",
        });
      }
      urls.push({
        photoId: photo.id,
        partNumber,
        url: await storage.presignPart(key, uploadId, partNumber, length, PART_URL_SECONDS),
      });
    }
  }
  return NextResponse.json({ urls, expiresIn: PART_URL_SECONDS });
});
