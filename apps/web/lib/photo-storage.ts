import "server-only";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { SendMessageCommand, SQSClient } from "@aws-sdk/client-sqs";
import { ApiError } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  type PhotoStorageSettings,
  photoDownloadRoleArn,
  photoStorageSettings,
} from "@daybell/config/server";
import {
  type LocalPhotoStorage,
  localPhotoStorage,
  type PhotoStorage,
  s3PhotoStorage,
} from "@daybell/storage";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/**
 * Each region's photo storage (ADR 0016). On Vercel: S3 in ca-central-1, with short-lived credentials from Vercel's
 * OIDC token (role AWS_ROLE_ARN; no AWS keys anywhere). In development, CI and end-to-end tests: the local driver
 * (STORAGE_DRIVER=local), whose URLs point at /api/dev-storage. Misconfiguration is logged by variable name only.
 */

interface RegionStorage {
  settings: PhotoStorageSettings;
  storage: PhotoStorage;
  sqs?: SQSClient;
}

const cache = new Map<DataRegion, RegionStorage>();

/** One random secret per server process signs the local driver's URLs; the same process checks them. */
const LOCAL_SECRET_KEY = Symbol.for("daybell.localStorageSecret");
function localSecret(): Uint8Array {
  const g = globalThis as { [LOCAL_SECRET_KEY]?: Uint8Array };
  g[LOCAL_SECRET_KEY] ??= randomBytes(32);
  return g[LOCAL_SECRET_KEY];
}

function settingsFor(region: DataRegion): PhotoStorageSettings {
  let settings: PhotoStorageSettings | null;
  try {
    settings = photoStorageSettings(region);
  } catch (err) {
    // The message names the variable (never a value).
    console.error("photo_storage_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  if (!settings)
    throw new ApiError("region_unavailable", "Photos can't be stored in this region yet.");
  return settings;
}

function regionStorage(region: DataRegion): RegionStorage {
  const cached = cache.get(region);
  if (cached) return cached;
  const settings = settingsFor(region);
  let made: RegionStorage;
  if (settings.driver === "local") {
    made = {
      settings,
      storage: localPhotoStorage({
        // Local only (refused in production), so the folder is never traced into a deployment.
        root: resolve(/*turbopackIgnore: true*/ process.cwd(), settings.root),
        secret: localSecret(),
      }),
    };
  } else {
    const credentials = awsCredentialsProvider({
      roleArn: settings.roleArn,
      clientConfig: { region: settings.awsRegion },
    });
    const client = new S3Client({
      region: settings.awsRegion,
      credentials,
      // Presigned part URLs must not carry a checksum the browser can't compute.
      requestChecksumCalculation: "WHEN_REQUIRED",
    });
    made = {
      settings,
      storage: s3PhotoStorage({ client, bucket: settings.bucket }),
      sqs: new SQSClient({ region: settings.awsRegion, credentials }),
    };
  }
  cache.set(region, made);
  return made;
}

export function photoStorage(region: DataRegion): PhotoStorage {
  return regionStorage(region).storage;
}

/** The local driver, for the dev-storage route; null with any other driver (the route then doesn't exist). */
export function localStorageDriver(region: DataRegion): LocalPhotoStorage | null {
  if (process.env.STORAGE_DRIVER !== "local") return null;
  const { settings, storage } = regionStorage(region);
  return settings.driver === "local" ? (storage as LocalPhotoStorage) : null;
}

export function isLocalDriver(region: DataRegion): boolean {
  return settingsFor(region).driver === "local";
}

/**
 * Asks for a photo's previews to be made. With S3, a photo's upload already queued it (S3's event); this is for
 * retries: the message carries the photo's id only (D113: record IDs only). With the local driver there is no queue:
 * the caller processes the photo itself after responding.
 */
export async function queuePhotoForProcessing(region: DataRegion, photoId: string): Promise<void> {
  const { settings, sqs } = regionStorage(region);
  if (settings.driver !== "s3" || !sqs) return;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: settings.queueUrl,
      MessageBody: JSON.stringify({ photoId }),
    }),
  );
}

/**
 * The storage that signs parents' paid downloads (ADR 0023, call 10). With S3, its own client with the download role's
 * short-lived credentials (AWS_DOWNLOAD_ROLE_ARN: `*\/download.jpg` only), so the role that signs everything else
 * still never reads a full-resolution file (ADR 0016). With the local driver, the usual one.
 */
const downloadCache = new Map<DataRegion, PhotoStorage>();
export function photoDownloadStorage(region: DataRegion): PhotoStorage {
  const cached = downloadCache.get(region);
  if (cached) return cached;
  const { settings, storage } = regionStorage(region);
  if (settings.driver === "local") return storage;
  let roleArn: string | null;
  try {
    roleArn = photoDownloadRoleArn(region);
  } catch (err) {
    // The message names the variable (never a value).
    console.error("photo_storage_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  if (!roleArn)
    throw new ApiError("region_unavailable", "Photos can't be stored in this region yet.");
  const client = new S3Client({
    region: settings.awsRegion,
    credentials: awsCredentialsProvider({ roleArn, clientConfig: { region: settings.awsRegion } }),
  });
  const made = s3PhotoStorage({ client, bucket: settings.bucket });
  downloadCache.set(region, made);
  return made;
}

/**
 * Asks for a ready photo's paid download to be made (the backfill, ADR 0023): a photo processed before downloads
 * existed. The message carries the photo's id only (D113). With the local driver there is no queue: the caller makes
 * it itself after responding.
 */
export async function queueDownloadForProcessing(
  region: DataRegion,
  photoId: string,
): Promise<void> {
  const { settings, sqs } = regionStorage(region);
  if (settings.driver !== "s3" || !sqs) return;
  await sqs.send(
    new SendMessageCommand({
      QueueUrl: settings.queueUrl,
      MessageBody: JSON.stringify({ photoId, make: "download" }),
    }),
  );
}
