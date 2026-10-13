import { type DerivativeVariant, DOWNLOAD_VARIANT, MAX_PHOTO_BYTES, photoKey } from "@daybell/core";
import {
  DERIVATIVE_CONTENT_TYPE,
  DOWNLOAD_CONTENT_TYPE,
  type FailureReason,
  type PhotoFacts,
  processDownload,
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
  /** The round of processing; the result is reported for it, so a late result of an earlier round is ignored. */
  attempt: number;
  /** For the watermark (Seenu, answer 4). Never logged. */
  studioName: string;
}

export type WorkerResult = (
  | ({ status: "ready" } & PhotoFacts)
  | { status: "failed"; failureReason: FailureReason }
) & { attempt: number };

export interface PhotoJobDeps {
  photo(photoId: string): Promise<WorkerPhoto | null>;
  head(key: string): Promise<{ size: number } | null>;
  get(key: string): Promise<Uint8Array<ArrayBuffer>>;
  put(key: string, body: Uint8Array, contentType: string, cacheControl: string): Promise<void>;
  report(photoId: string, result: WorkerResult): Promise<void>;
  /** An event name, the photo's id and maybe a reason: nothing else. */
  log(event: string, photoId: string, reason?: string): void;
  sleep?(ms: number): Promise<void>;
}

/**
 * S3 announces an original when its upload completes, a moment before the API marks the photo uploaded. A photo
 * still "uploading" is checked again a few times; then the message goes back to the queue (an error), so SQS tries
 * again later instead of dropping it.
 */
export const UPLOADING_CHECKS = 3;
export const UPLOADING_PAUSE_MS = 5000;

export class PhotoNotUploadedYet extends Error {
  constructor() {
    super("photo_not_uploaded_yet");
    this.name = "PhotoNotUploadedYet";
  }
}

/** Previews are private: only signed URLs read them, and browsers may keep them for an hour. */
export const PREVIEW_CACHE_CONTROL = "private, max-age=3600";
/** A paid download is saved, never cached on the way (ADR 0023). */
export const DOWNLOAD_CACHE_CONTROL = "private, no-store";

export type PhotoJobOutcome = "ready" | "failed" | "skipped";

export async function runPhotoJob(
  photoId: string,
  deps: PhotoJobDeps,
  /** The watermark font and zxing's reader .wasm, where a bundle keeps its own copies. */
  options: { fontFile?: string; qrWasmFile?: string } = {},
): Promise<PhotoJobOutcome> {
  let photo = await deps.photo(photoId);
  for (let check = 1; photo?.status === "uploading"; check++) {
    if (check > UPLOADING_CHECKS) throw new PhotoNotUploadedYet();
    await (deps.sleep ?? ((ms) => new Promise((ok) => setTimeout(ok, ms))))(UPLOADING_PAUSE_MS);
    photo = await deps.photo(photoId);
  }
  if (!photo) {
    // Deleted (a cancelled upload, or purged): nothing to do.
    deps.log("photo_skipped", photoId, "missing");
    return "skipped";
  }
  if (photo.status !== "processing") {
    // Already done (a repeated message).
    deps.log("photo_skipped", photoId, photo.status);
    return "skipped";
  }
  const ids = { studioId: photo.studioId, jobId: photo.jobId, photoId: photo.id };
  const fail = async (reason: FailureReason): Promise<PhotoJobOutcome> => {
    deps.log("photo_failed", photoId, reason);
    await deps.report(photoId, { status: "failed", failureReason: reason, attempt: photo.attempt });
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
    ...(options.fontFile ? { fontFile: options.fontFile } : {}),
    ...(options.qrWasmFile ? { qrWasmFile: options.qrWasmFile } : {}),
  });
  if (!result.ok) return fail(result.reason);
  // The previews only: the paid download is made once the photo is sold (runDownloadJob; security review N1).
  await Promise.all(
    (Object.entries(result.derivatives) as [DerivativeVariant, Buffer][]).map(([variant, body]) =>
      deps.put(photoKey(ids, variant), body, DERIVATIVE_CONTENT_TYPE, PREVIEW_CACHE_CONTROL),
    ),
  );
  await deps.report(photoId, { status: "ready", ...result.facts, attempt: photo.attempt });
  deps.log("photo_ready", photoId);
  return "ready";
}

/**
 * Makes `download.jpg` for a sold photo (ADR 0023 §10), lazily: asked for by the API when the photo's order is paid,
 * and again when a paid download finds it missing (at most every 5 minutes, 3 times), with a queue message
 * `{photoId, make: "download"}` (ids only). Nothing is reported back: the API finds the file by looking. A photo that
 * isn't ready, or is gone, is skipped; a failure is logged with its reason and the photo is left as it is (after 3
 * requests the API answers that the download is unavailable, and alerts).
 */
export async function runDownloadJob(
  photoId: string,
  deps: Pick<PhotoJobDeps, "photo" | "head" | "get" | "put" | "log">,
): Promise<PhotoJobOutcome> {
  const photo = await deps.photo(photoId);
  if (photo?.status !== "ready") {
    deps.log("download_skipped", photoId, photo ? photo.status : "missing");
    return "skipped";
  }
  const ids = { studioId: photo.studioId, jobId: photo.jobId, photoId: photo.id };
  const key = photoKey(ids, "original");
  const head = await deps.head(key);
  if (!head) {
    deps.log("download_skipped", photoId, "original_missing");
    return "skipped";
  }
  if (head.size > MAX_PHOTO_BYTES || head.size !== photo.byteSize) {
    deps.log(
      "download_failed",
      photoId,
      head.size > MAX_PHOTO_BYTES ? "too_large" : "hash_mismatch",
    );
    return "failed";
  }
  const result = await processDownload(await deps.get(key), { expectedSha256: photo.sha256 });
  if (!result.ok) {
    deps.log("download_failed", photoId, result.reason);
    return "failed";
  }
  await deps.put(
    photoKey(ids, DOWNLOAD_VARIANT),
    result.download,
    DOWNLOAD_CONTENT_TYPE,
    DOWNLOAD_CACHE_CONTROL,
  );
  deps.log("download_ready", photoId);
  return "ready";
}
