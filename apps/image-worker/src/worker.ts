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

/** What the worker reads from its environment: no secrets (those are in Secrets Manager, read at cold start). */
export interface EnvConfig {
  callbackBaseUrl: string;
  region: "ca";
  bucket: string;
  /** The Secrets Manager secret holding the signing secret and Vercel's bypass, in ca-central-1. */
  secretArn: string;
}

const SECRET_ARN = /^arn:aws:secretsmanager:ca-central-1:\d{12}:secret:[A-Za-z0-9/_+=.@-]+$/;

/** Every value a variable must have, by name only, so a misconfigured worker fails loudly and never quietly. */
export function configFromEnv(env: Record<string, string | undefined>): EnvConfig {
  const need = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is not set`);
    return value;
  };
  const region = need("DATA_REGION");
  if (region !== "ca") throw new Error("DATA_REGION must be ca");
  // Canadian photos are processed in Canada only (D113). AWS_REGION is set by Lambda itself.
  if (need("AWS_REGION") !== "ca-central-1") throw new Error("AWS_REGION must be ca-central-1");
  const secretArn = need("PHOTO_WORKER_SECRETS_ARN");
  if (!SECRET_ARN.test(secretArn))
    throw new Error("PHOTO_WORKER_SECRETS_ARN must be a Secrets Manager secret in ca-central-1");
  const base = need("CALLBACK_BASE_URL").replace(/\/+$/, "");
  if (!base.startsWith("https://")) throw new Error("CALLBACK_BASE_URL must be https");
  return { callbackBaseUrl: base, region, bucket: need("PHOTO_BUCKET"), secretArn };
}

/**
 * The secret's value: JSON with `photoWorkerSecret` (at least 32 characters; one of the API's PHOTO_WORKER_SECRETS)
 * and, when Vercel's deployment protection is on, `vercelProtectionBypass`. Errors name the field, never a value.
 */
export function secretsFromJson(text: string | undefined): {
  secret: string;
  protectionBypass?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text ?? "");
  } catch {
    throw new Error("The worker's secret must be JSON");
  }
  const v = parsed as { photoWorkerSecret?: unknown; vercelProtectionBypass?: unknown };
  if (typeof v.photoWorkerSecret !== "string" || v.photoWorkerSecret.trim().length < 32)
    throw new Error("photoWorkerSecret must be at least 32 characters");
  const bypass =
    typeof v.vercelProtectionBypass === "string" ? v.vercelProtectionBypass.trim() : "";
  return { secret: v.photoWorkerSecret.trim(), ...(bypass ? { protectionBypass: bypass } : {}) };
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
      if (res.status === 404) {
        // Only the API's own "not found" means the photo is gone; any other 404 (a wrong address, a proxy) is an
        // error, so the message is tried again rather than dropped.
        const body = (await res.json().catch(() => null)) as { error?: { code?: string } } | null;
        if (body?.error?.code === "not_found") return null;
        throw new Error("api_404");
      }
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
  sleep?: (ms: number) => Promise<void>;
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
    ...(parts.sleep ? { sleep: parts.sleep } : {}),
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
