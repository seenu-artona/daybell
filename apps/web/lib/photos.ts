import "server-only";
import { resolve } from "node:path";
import {
  ApiError,
  fromDatabaseError,
  PHOTO_CONFLICTS,
  type Photo,
  type StudioSummary,
} from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { canEditRoster, photoKey, photoPrefix } from "@daybell/core";
import type { PhotoStorage } from "@daybell/storage";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { isLocalDriver, queuePhotoForProcessing } from "./photo-storage";
import { photoSystemRpc, photoWriteRpc } from "./supabase/service";

/**
 * Server helpers for photos (Phase 1 step 4, ADR 0016). Only IDs go in URLs, keys and logs; a photo's filename is read
 * from the database and sent to the studio's own screens only.
 */

type DbError = { code?: string; message?: string } | null;

/** Owners, admins and photographers upload and bin (Seenu, answer 6). The database checks it again. */
export function assertCanUpload(studio: StudioSummary): void {
  if (!canEditRoster(studio.role))
    throw new ApiError("forbidden", "Owners, admins and photographers only.");
}

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

/** The named refusals of the photo functions (their messages carry no values), as API errors. */
const NAMED: Record<string, () => ApiError> = {
  job_closed: () =>
    conflict("This job is closed, so it takes no more photos.", PHOTO_CONFLICTS.jobClosed),
  photo_limit: () =>
    conflict("A job holds at most 50,000 photos, the bin included.", PHOTO_CONFLICTS.photoLimit),
  batch_finished: () => conflict("This upload has finished.", PHOTO_CONFLICTS.batchFinished),
  not_uploading: () => conflict("This photo isn't uploading.", PHOTO_CONFLICTS.notUploading),
  photo_sold: () =>
    conflict("A photo that has sold can't be moved to the bin.", PHOTO_CONFLICTS.photoSold),
  not_retryable: () =>
    conflict("This photo can't be tried again right now.", PHOTO_CONFLICTS.notRetryable),
  photo_purging: () =>
    conflict(
      "This photo is being deleted for good and can't be restored.",
      PHOTO_CONFLICTS.photoPurging,
    ),
};

export function photoError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  if (error.code === "P0002") return new ApiError("not_found", "We couldn't find that.");
  if (error.code === "22023") return new ApiError("invalid_input", "Please check what you sent.");
  return fromDatabaseError(error);
}

/** The data of a photo function's result, or the matching API error. */
export function photoResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw photoError(result.error);
  return result.data as T;
}

export const INCOMPLETE = conflict(
  "Some parts of this photo haven't arrived. Upload the missing parts and try again.",
  PHOTO_CONFLICTS.incomplete,
);

/** A batch of the studio, through row-level security (another studio's batch is simply not found). */
export async function loadBatch(
  supabase: SupabaseClient,
  studioId: string,
  batchId: string,
): Promise<{ id: string; job_id: string }> {
  const batch = check(
    await supabase
      .from("upload_batches")
      .select("id, job_id")
      .eq("studio_id", studioId)
      .eq("id", batchId)
      .maybeSingle(),
  ) as { id: string; job_id: string } | null;
  if (!batch) throw new ApiError("not_found", "Upload not found.");
  return batch;
}

/** Columns the API reads from photos. Never the storage upload id (browsers can't read it anyway). */
export const PHOTO_COLUMNS =
  "id, job_id, batch_id, status, original_filename, byte_size, width, height, captured_at, failure_reason, binned_at, created_at, updated_at";

export interface PhotoRow {
  id: string;
  job_id?: string;
  batch_id: string;
  status: "uploading" | "processing" | "ready" | "failed";
  original_filename: string;
  byte_size: number;
  width: number | null;
  height: number | null;
  captured_at: string | null;
  failure_reason: Photo["failureReason"];
  binned_at: string | null;
  created_at: string;
  updated_at: string;
}

/** A photo processing this long is stuck (its message went to the dead-letter queue) and may be tried again. */
export const STUCK_MS = 15 * 60 * 1000;

/** A photo of the studio, through row-level security. */
export async function loadPhoto(
  supabase: SupabaseClient,
  studioId: string,
  photoId: string,
): Promise<PhotoRow & { job_id: string }> {
  const row = check(
    await supabase
      .from("photos")
      .select(PHOTO_COLUMNS)
      .eq("studio_id", studioId)
      .eq("id", photoId)
      .maybeSingle(),
  ) as (PhotoRow & { job_id: string }) | null;
  if (!row) throw new ApiError("not_found", "Photo not found.");
  return row;
}

/** Postgres returns "2026-10-01T09:30:05.47" for a timestamp without zone; kept exactly as the camera wrote it. */
export function toPhoto(row: PhotoRow, thumbUrl: string | null, now = Date.now()): Photo {
  const retryable =
    row.binned_at === null &&
    ((row.status === "failed" && row.failure_reason === "unreadable") ||
      (row.status === "processing" && now - Date.parse(row.updated_at) > STUCK_MS));
  return {
    id: row.id,
    batchId: row.batch_id,
    status: row.status === "uploading" ? "processing" : row.status,
    originalFilename: row.original_filename,
    byteSize: Number(row.byte_size),
    width: row.width,
    height: row.height,
    capturedAt: row.captured_at,
    failureReason: row.failure_reason,
    binnedAt: row.binned_at,
    createdAt: row.created_at,
    retryable,
    thumbUrl,
  };
}

/** Previews are signed for an hour at most (never longer than the credentials signing them). */
export const PREVIEW_URL_SECONDS = 3600;

/** A signed URL to one of a ready photo's plain previews (studio only). */
export async function previewUrl(
  storage: PhotoStorage,
  ids: { studioId: string; jobId: string; photoId: string },
  variant: "thumb.webp" | "view.webp",
): Promise<string> {
  return storage.presignGet(photoKey(ids, variant), { expiresIn: PREVIEW_URL_SECONDS });
}

/** One photo still uploading, as photos_uploading returns it. */
export interface UploadingPhoto {
  id: string;
  studio_id: string;
  job_id: string;
  byte_size: number;
  upload_id: string | null;
}

/**
 * One photo of the studio that is still uploading, with its storage upload id (read by the server only). Another
 * studio's photo is not found; one of the studio's that has finished uploading is a conflict.
 */
export async function uploadingPhoto(
  supabase: SupabaseClient,
  studio: StudioSummary,
  userId: string,
  photoId: string,
): Promise<UploadingPhoto> {
  const visible = await loadPhoto(supabase, studio.id, photoId);
  const [photo] = photoResult<UploadingPhoto[]>(
    await photoWriteRpc(studio.region, "photos_uploading", userId, { p_photo_ids: [photoId] }),
  );
  if (!photo || photo.studio_id !== studio.id || photo.job_id !== visible.job_id)
    throw conflict("This photo isn't uploading.", PHOTO_CONFLICTS.notUploading);
  return photo;
}

export const keyParts = (p: { studio_id: string; job_id: string; id: string }) => ({
  studioId: p.studio_id,
  jobId: p.job_id,
  photoId: p.id,
});

/**
 * Processes a photo in this server process (the local driver only: development, CI and end-to-end tests). The same
 * steps as the Lambda, with the database and the local folder instead of signed calls and S3. The image pipeline (and
 * sharp) is loaded only here.
 */
export async function processLocally(
  region: DataRegion,
  storage: PhotoStorage,
  photoId: string,
): Promise<void> {
  const { runPhotoJob } = await import("@daybell/image-pipeline");
  try {
    await runPhotoJob(
      photoId,
      {
        async photo(id) {
          const row = photoResult<{
            id: string;
            studio_id: string;
            job_id: string;
            status: "uploading" | "processing" | "ready" | "failed";
            sha256: string;
            byte_size: number;
            attempt: number;
            studio_name: string;
          } | null>(await photoSystemRpc(region, "photo_for_worker", { p_photo_id: id }));
          return row
            ? {
                id: row.id,
                studioId: row.studio_id,
                jobId: row.job_id,
                status: row.status,
                sha256: row.sha256,
                byteSize: Number(row.byte_size),
                attempt: Number(row.attempt),
                studioName: row.studio_name,
              }
            : null;
        },
        head: (key) => storage.head(key),
        get: (key) => storage.get(key),
        put: (key, body, contentType, cacheControl) =>
          storage.put(key, body, { contentType, cacheControl }),
        async report(id, result) {
          photoResult(
            await photoSystemRpc(region, "record_photo_result", {
              p_photo_id: id,
              p_attempt: result.attempt,
              p_result: workerResultRow(result),
            }),
          );
        },
        log: (event, id, reason) => {
          if (event !== "photo_ready") console.error(event, id, reason ?? "");
        },
      },
      // The same font file as the QR cards' (ADR 0015), read from the app's own folder.
      { fontFile: resolve(process.cwd(), "assets/fonts/PlusJakartaSans-Bold.ttf") },
    );
  } catch (err) {
    console.error("photo_local_error", photoId, err instanceof Error ? err.name : "unknown");
  }
}

/** The worker's result as record_photo_result takes it. */
export function workerResultRow(
  result:
    | { status: "ready"; width: number; height: number; capturedAt: string | null }
    | { status: "failed"; failureReason: string },
): Record<string, unknown> {
  return result.status === "ready"
    ? {
        status: "ready",
        width: result.width,
        height: result.height,
        captured_at: result.capturedAt,
      }
    : { status: "failed", failure_reason: result.failureReason };
}

/**
 * After an original is whole in storage: the photo moves to processing, and its previews are queued. With S3, S3's
 * own event queues it, except when `requeue` (the upload was completed by an earlier request that didn't get as far
 * as marking it): then it is queued here too, which is harmless if it was already (the worker is idempotent). With the
 * local driver it is processed here, after the response.
 */
export async function markUploaded(
  region: DataRegion,
  storage: PhotoStorage,
  userId: string,
  photoId: string,
  options: { requeue: boolean; after: (fn: () => Promise<void>) => void },
): Promise<void> {
  photoResult(await photoWriteRpc(region, "mark_photo_uploaded", userId, { p_photo_id: photoId }));
  if (isLocalDriver(region)) options.after(() => processLocally(region, storage, photoId));
  else if (options.requeue) await queuePhotoForProcessing(region, photoId);
}

/**
 * The storage upload is gone (completed by an earlier request, or aborted). If the original is there at its declared
 * size, the photo is uploaded: mark and queue it. Otherwise nothing more can be sent to that upload, so the photo is
 * cancelled; dropping the file again starts afresh. Answers whether the photo is now uploaded.
 */
export async function recoverFinishedUpload(
  region: DataRegion,
  storage: PhotoStorage,
  userId: string,
  photo: UploadingPhoto,
  after: (fn: () => Promise<void>) => void,
): Promise<boolean> {
  const stored = await storage.head(photoKey(keyParts(photo), "original"));
  if (stored?.size === Number(photo.byte_size)) {
    await markUploaded(region, storage, userId, photo.id, { requeue: true, after });
    return true;
  }
  photoResult(await photoWriteRpc(region, "cancel_photo_upload", userId, { p_photo_id: photo.id }));
  await storage.deleteAllVersions(photoPrefix(keyParts(photo)));
  return false;
}
