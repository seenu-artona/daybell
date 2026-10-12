import { type DerivativeVariant, MAX_PHOTO_BYTES, photoKey } from "@daybell/core";
import {
  DERIVATIVE_CONTENT_TYPE,
  type FailureReason,
  type PhotoFacts,
  processOriginal,
} from "./process";

/**
 * One photo's processing, the same in the Lambda (S3, signed calls to the API) and in the local driver (a folder and
 * the database): read what the API knows, check and make the previews, store them, report back. Only IDs and reasons
 * are ever logged.
 */

/** What the API tells the worker about a photo (from the internal route). Never the filename. */
export interface WorkerPhoto {
  id: string;
  studioId: string;
  jobId: string;
  status: "uploading" | "processing" | "ready" | "failed";
  sha256: string;
  byteSize: number;
  /** For the watermark (Seenu, answer 4). Never logged. */
  studioName: string;
}

export type WorkerResult =
  | ({ status: "ready" } & PhotoFacts)
  | { status: "failed"; failureReason: FailureReason };

export interface PhotoJobDeps {
  photo(photoId: string): Promise<WorkerPhoto | null>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Uint8Array<ArrayBuffer>>;
  put(key: string, body: Uint8Array, contentType: string, cacheControl: string): Promise<void>;
  report(photoId: string, result: WorkerResult): Promise<void>;
  /** An event name, the photo's id and maybe a reason: nothing else. */
  log(event: string, photoId: string, reason?: string): void;
}

/** Previews are private: only signed URLs read them, and browsers may keep them for an hour. */
export const PREVIEW_CACHE_CONTROL = "private, max-age=3600";

export type PhotoJobOutcome = "ready" | "failed" | "skipped";

export async function runPhotoJob(photoId: string, deps: PhotoJobDeps): Promise<PhotoJobOutcome> {
  const photo = await deps.photo(photoId);
  if (!photo) {
    // Deleted (a cancelled upload, or purged): nothing to do.
    deps.log("photo_skipped", photoId, "missing");
    return "skipped";
  }
  if (photo.status !== "processing") {
    // Already done (a repeated message) or not uploaded yet.
    deps.log("photo_skipped", photoId, photo.status);
    return "skipped";
  }
  const ids = { studioId: photo.studioId, jobId: photo.jobId, photoId: photo.id };
  const fail = async (reason: FailureReason): Promise<PhotoJobOutcome> => {
    deps.log("photo_failed", photoId, reason);
    await deps.report(photoId, { status: "failed", failureReason: reason });
    return "failed";
  };

  const key = photoKey(ids, "original");
  const head = await deps.head(key);
  if (!head) {
    deps.log("photo_skipped", photoId, "original_missing");
    return "skipped";
  }
  // Checked before reading, so a huge object is never loaded into memory.
  if (head.size > MAX_PHOTO_BYTES) return fail("too_large");
  if (head.size !== photo.byteSize) return fail("hash_mismatch");

  const result = await processOriginal(await deps.get(key), {
    studioName: photo.studioName,
    expectedSha256: photo.sha256,
  });
  if (!result.ok) return fail(result.reason);
  await Promise.all(
    (Object.entries(result.derivatives) as [DerivativeVariant, Buffer][]).map(([variant, body]) =>
      deps.put(photoKey(ids, variant), body, DERIVATIVE_CONTENT_TYPE, PREVIEW_CACHE_CONTROL),
    ),
  );
  await deps.report(photoId, { status: "ready", ...result.facts });
  deps.log("photo_ready", photoId);
  return "ready";
}
