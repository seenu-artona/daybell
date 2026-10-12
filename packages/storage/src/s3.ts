import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectVersionsCommand,
  ListPartsCommand,
  type ObjectIdentifier,
  PutObjectCommand,
  type S3Client,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { type PhotoStorage, StorageError, type UploadedPart } from "./types";

/** S3 keys this driver accepts: IDs, slashes, dots and dashes only (see photoKey). */
const SAFE_KEY = /^[0-9a-z][0-9a-z./-]*$/;

function checkKey(key: string): string {
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//"))
    throw new StorageError("invalid_key");
  return key;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

/**
 * The S3 driver (S3 in ca-central-1 now; R2 later through the same API). The client is made by the caller: on Vercel
 * with credentials from Vercel's OIDC token, in the Lambda from its execution role. Create it with
 * `requestChecksumCalculation: "WHEN_REQUIRED"`, so presigned part URLs carry no checksum a browser can't send.
 */
export function s3PhotoStorage({
  client,
  bucket,
}: {
  client: S3Client;
  bucket: string;
}): PhotoStorage {
  return {
    async createMultipart(key, contentType) {
      const out = await client.send(
        new CreateMultipartUploadCommand({
          Bucket: bucket,
          Key: checkKey(key),
          ContentType: contentType,
        }),
      );
      if (!out.UploadId) throw new StorageError("unavailable");
      return out.UploadId;
    },

    presignPart(key, uploadId, partNumber, contentLength, expiresIn) {
      return getSignedUrl(
        client,
        new UploadPartCommand({
          Bucket: bucket,
          Key: checkKey(key),
          UploadId: uploadId,
          PartNumber: partNumber,
          ContentLength: contentLength,
        }),
        // The length is a signed header: a PUT of any other size is refused by S3.
        { expiresIn, signableHeaders: new Set(["content-length"]) },
      );
    },

    async listParts(key, uploadId) {
      const parts: UploadedPart[] = [];
      let marker: string | undefined;
      for (;;) {
        const out = await client.send(
          new ListPartsCommand({
            Bucket: bucket,
            Key: checkKey(key),
            UploadId: uploadId,
            ...(marker ? { PartNumberMarker: marker } : {}),
          }),
        );
        for (const p of out.Parts ?? [])
          if (p.PartNumber && p.ETag && p.Size !== undefined)
            parts.push({ partNumber: p.PartNumber, size: p.Size, etag: p.ETag });
        if (!out.IsTruncated || !out.NextPartNumberMarker) break;
        marker = out.NextPartNumberMarker;
      }
      return parts.sort((a, b) => a.partNumber - b.partNumber);
    },

    async complete(key, uploadId, parts) {
      await client.send(
        new CompleteMultipartUploadCommand({
          Bucket: bucket,
          Key: checkKey(key),
          UploadId: uploadId,
          MultipartUpload: {
            Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })),
          },
        }),
      );
    },

    async abort(key, uploadId) {
      try {
        await client.send(
          new AbortMultipartUploadCommand({
            Bucket: bucket,
            Key: checkKey(key),
            UploadId: uploadId,
          }),
        );
      } catch (err) {
        if (!isNotFound(err) && (err as { name?: string })?.name !== "NoSuchUpload") throw err;
      }
    },

    async head(key) {
      try {
        const out = await client.send(
          new HeadObjectCommand({ Bucket: bucket, Key: checkKey(key) }),
        );
        return { size: out.ContentLength ?? 0 };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },

    async get(key) {
      const out = await client.send(new GetObjectCommand({ Bucket: bucket, Key: checkKey(key) }));
      if (!out.Body) throw new StorageError("not_found");
      return new Uint8Array(await out.Body.transformToByteArray());
    },

    async put(key, body, { contentType, cacheControl }) {
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: checkKey(key),
          Body: body,
          ContentType: contentType,
          ...(cacheControl ? { CacheControl: cacheControl } : {}),
        }),
      );
    },

    presignGet(key, { expiresIn, signedAt }) {
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: checkKey(key) }), {
        expiresIn,
        ...(signedAt ? { signingDate: signedAt } : {}),
      });
    },

    async deleteAllVersions(prefix) {
      checkKey(prefix);
      if (!prefix.endsWith("/")) throw new StorageError("invalid_key");
      let deleted = 0;
      let keyMarker: string | undefined;
      let versionMarker: string | undefined;
      for (;;) {
        const out = await client.send(
          new ListObjectVersionsCommand({
            Bucket: bucket,
            Prefix: prefix,
            ...(keyMarker ? { KeyMarker: keyMarker } : {}),
            ...(versionMarker ? { VersionIdMarker: versionMarker } : {}),
          }),
        );
        const objects: ObjectIdentifier[] = [...(out.Versions ?? []), ...(out.DeleteMarkers ?? [])]
          .filter((v) => v.Key?.startsWith(prefix))
          .map((v) => ({
            Key: v.Key as string,
            ...(v.VersionId ? { VersionId: v.VersionId } : {}),
          }));
        if (objects.length > 0) {
          const result = await client.send(
            new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: objects, Quiet: true } }),
          );
          if (result.Errors?.length) throw new StorageError("unavailable");
          deleted += objects.length;
        }
        if (!out.IsTruncated) break;
        keyMarker = out.NextKeyMarker;
        versionMarker = out.NextVersionIdMarker;
      }
      return deleted;
    },
  };
}
