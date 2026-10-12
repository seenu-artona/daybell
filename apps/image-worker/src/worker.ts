import {
  isUuid,
  parsePhotoKey,
  signWorkerRequest,
  WORKER_REGION_HEADER,
  WORKER_SIGNATURE_HEADER,
} from "@daybell/core";
import {
  type PhotoJobDeps,
  runPhotoJob,
  type WorkerPhoto,
  type WorkerResult,
} from "@daybell/image-pipeline";
import type { PhotoStorage } from "@daybell/storage";
import type { SQSBatchResponse, SQSEvent } from "aws-lambda";

/**
 * The image worker (ADR 0016): an AWS Lambda in the studio's region (ca-central-1 for Canada, D113). S3 tells the
 * photo-events queue when an original lands; each message runs here once (batch size 1). The worker asks the API what
 * it needs over a signed call (ids, the expected hash, the studio's name for the watermark), makes the previews and
 * reports back to the API (D92). It never touches the database and never logs anything but photo ids and reasons.
 */

export interface WorkerConfig {
  /** The regional API's address, e.g. the staging deployment. */
  callbackBaseUrl: string;
  /** Signs every call to the API (one of the API's PHOTO_WORKER_SECRETS). */
  secret: string;
  /** Vercel's Protection Bypass for Automation, when the deployment is protected. */
  protectionBypass?: string;
  /** The data region this worker serves; signed into every call. */
  region: "ca";
  /** The bucket this worker reads and writes. Messages about other buckets are ignored. */
  bucket: string;
}

export type Log = (event: string, photoId: string, reason?: string) => void;

/** Lines CloudWatch keeps: an event, a photo id and maybe a reason. Nothing else, ever. */
export const log: Log = (event, photoId, reason) => {
  console.error(JSON.stringify(reason ? { event, photoId, reason } : { event, photoId }));
};

/** Every value a variable must have, by name only, so a misconfigured worker fails loudly and never quietly. */
export function configFromEnv(env: Record<string, string | undefined>): WorkerConfig {
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const region = need("DATA_REGION");
  if (region !== "ca") throw new Error("DATA_REGION must be ca");
  // Canadian photos are processed in Canada only (D113). AWS_REGION is set by Lambda itself.
  if (need("AWS_REGION") !== "ca-central-1") throw new Error("AWS_REGION must be ca-central-1");
  const secret = need("PHOTO_WORKER_SECRET");
  if (secret.length < 32) throw new Error("PHOTO_WORKER_SECRET must be at least 32 characters");
  const base = need("CALLBACK_BASE_URL").replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error("CALLBACK_BASE_URL must be https");
  const bypass = env.VERCEL_PROTECTION_BYPASS?.trim();
  return {
    callbackBaseUrl: base,
    secret,
    region,
    bucket: need("PHOTO_BUCKET"),
    ...(bypass ? { protectionBypass: bypass } : {}),
  };
}

/**
 * The photo ids a queue message is about. S3 events name the original's key (IDs only); a retry from the API names
 * the photo. S3's test event and anything else name none.
 */
export function photoIdsFromMessage(body: string, bucket: string): string[] {
  let message: unknown;
  try {
    message = JSON.parse(body);
  } catch {
    return [];
  }
  const m = message as {
    photoId?: unknown;
    Records?: {
      eventSource?: string;
      s3?: { bucket?: { name?: string }; object?: { key?: string } };
    }[];
  };
  if (typeof m.photoId === "string") return isUuid(m.photoId) ? [m.photoId.toLowerCase()] : [];
  if (!Array.isArray(m.Records)) return [];
  return m.Records.flatMap((r) => {
    if (r.eventSource !== "aws:s3" || r.s3?.bucket?.name !== bucket) return [];
    // S3 encodes keys in events like a form (spaces as +); ours hold only ids, but decode properly anyway.
    const key = decodeURIComponent((r.s3?.object?.key ?? "").replace(/\+/g, " "));
    const parsed = parsePhotoKey(key);
    return parsed?.variant === "original" ? [parsed.photoId] : [];
  });
}

const API_PATH = "/api/v1/internal/photo-worker/photos";

/** Signed calls to the API's internal photo-worker routes. */
export function workerApi(config: WorkerConfig, fetchImpl: typeof fetch = fetch) {
  async function call(method: "GET" | "POST", path: string, body: string): Promise<Response> {
    const headers: Record<string, string> = {
      [WORKER_SIGNATURE_HEADER]: await signWorkerRequest(config.secret, {
        method,
        path,
        region: config.region,
        body,
      }),
      [WORKER_REGION_HEADER]: config.region,
    };
    if (body) headers["content-type"] = "application/json";
    if (config.protectionBypass) headers["x-vercel-protection-bypass"] = config.protectionBypass;
    return fetchImpl(`${config.callbackBaseUrl}${path}`, {
      method,
      headers,
      ...(body ? { body } : {}),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
  }

  return {
    async photo(photoId: string): Promise<WorkerPhoto | null> {
      const res = await call("GET", `${API_PATH}/${photoId}`, "");
      if (res.status === 404) return null;
      // The status only: a response body could echo data.
      if (!res.ok) throw new Error(`api_${res.status}`);
      return ((await res.json()) as { photo: WorkerPhoto }).photo;
    },
    async report(photoId: string, result: WorkerResult): Promise<void> {
      const res = await call("POST", `${API_PATH}/${photoId}/result`, JSON.stringify(result));
      if (!res.ok) throw new Error(`api_${res.status}`);
    },
  };
}

/**
 * The Lambda handler, with its parts passed in (tests use fakes). SQS delivers one message at a time; a failure is
 * reported for that message only, so SQS tries it again and, after five tries, moves it to the dead-letter queue.
 */
export function createHandler(parts: {
  config: WorkerConfig;
  storage: PhotoStorage;
  fetch?: typeof fetch;
  log?: Log;
}) {
  const api = workerApi(parts.config, parts.fetch);
  const write = parts.log ?? log;
  const deps: PhotoJobDeps = {
    photo: (id) => api.photo(id),
    head: (key) => parts.storage.head(key),
    get: (key) => parts.storage.get(key),
    put: (key, body, contentType, cacheControl) =>
      parts.storage.put(key, body, { contentType, cacheControl }),
    report: (id, result) => api.report(id, result),
    log: write,
  };

  return async (event: SQSEvent): Promise<SQSBatchResponse> => {
    const batchItemFailures: SQSBatchResponse["batchItemFailures"] = [];
    for (const record of event.Records) {
      const ids = photoIdsFromMessage(record.body, parts.config.bucket);
      if (ids.length === 0) write("message_ignored", record.messageId);
      for (const id of ids) {
        try {
          await runPhotoJob(id, deps);
        } catch (err) {
          // The error's name only: messages from libraries can quote URLs or bodies.
          write("photo_error", id, err instanceof Error ? err.name : "unknown");
          batchItemFailures.push({ itemIdentifier: record.messageId });
          break;
        }
      }
    }
    return { batchItemFailures };
  };
}
