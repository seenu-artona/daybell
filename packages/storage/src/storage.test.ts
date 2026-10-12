import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { S3Client } from "@aws-sdk/client-s3";
import { photoKey } from "@daybell/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { localPhotoStorage, StorageError, s3PhotoStorage } from "./index";

const ids = {
  studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
  photoId: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
};
const original = photoKey(ids, "original");
const prefix = original.replace(/original$/, "");

describe("local driver", () => {
  let root: string;
  let clock = Date.parse("2026-10-11T12:00:00Z");
  const make = () =>
    localPhotoStorage({ root, secret: new Uint8Array(32).fill(7), now: () => clock });
  const query = (url: string) => new URL(url, "http://localhost").searchParams;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), "daybell-storage-"));
    clock = Date.parse("2026-10-11T12:00:00Z");
  });
  afterEach(() => rm(root, { recursive: true, force: true }));

  it("uploads in parts to signed URLs, completes from what it received, and reads back", async () => {
    const storage = make();
    const uploadId = await storage.createMultipart(original, "image/jpeg");
    const one = new Uint8Array([1, 2, 3]);
    const two = new Uint8Array([4, 5]);
    const url1 = await storage.presignPart(original, uploadId, 1, 3, 900);
    const url2 = await storage.presignPart(original, uploadId, 2, 2, 900);
    expect(url1.startsWith(`/api/dev-storage/${original}?`)).toBe(true);
    await storage.receivePart(original, query(url2), two);
    await storage.receivePart(original, query(url1), one);
    const parts = await storage.listParts(original, uploadId);
    expect(parts.map((p) => [p.partNumber, p.size])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    await storage.complete(original, uploadId, parts);
    expect(await storage.head(original)).toEqual({ size: 5 });
    expect([...(await storage.get(original))]).toEqual([1, 2, 3, 4, 5]);
    const get = await storage.presignGet(original, { expiresIn: 60 });
    expect([...(await storage.readSigned(original, query(get)))]).toEqual([1, 2, 3, 4, 5]);
  });

  it("refuses a part of another length, a changed URL and an expired one", async () => {
    const storage = make();
    const uploadId = await storage.createMultipart(original, "image/jpeg");
    const url = await storage.presignPart(original, uploadId, 1, 3, 900);
    await expect(storage.receivePart(original, query(url), new Uint8Array(4))).rejects.toThrow(
      StorageError,
    );
    const tampered = query(url);
    tampered.set("length", "4");
    await expect(storage.receivePart(original, tampered, new Uint8Array(4))).rejects.toThrow(
      "invalid_signature",
    );
    const other = photoKey({ ...ids, photoId: ids.jobId }, "original");
    await expect(storage.receivePart(other, query(url), new Uint8Array(3))).rejects.toThrow(
      "invalid_signature",
    );
    clock += 901_000;
    await expect(storage.receivePart(original, query(url), new Uint8Array(3))).rejects.toThrow(
      "invalid_signature",
    );
  });

  it("refuses keys that aren't plain IDs, and paths out of its folder", async () => {
    const storage = make();
    for (const key of ["../etc/passwd", "a/../../x", "/abs", "Maya.jpg", ".uploads/x"])
      await expect(storage.put(key, new Uint8Array(1), { contentType: "x" })).rejects.toThrow(
        "invalid_key",
      );
  });

  it("aborts uploads and deletes a photo's every object", async () => {
    const storage = make();
    const uploadId = await storage.createMultipart(original, "image/jpeg");
    await storage.abort(original, uploadId);
    await expect(storage.listParts(original, uploadId)).rejects.toThrow("not_found");
    await storage.put(original, new Uint8Array(1), { contentType: "image/jpeg" });
    await storage.put(photoKey(ids, "thumb.webp"), new Uint8Array(1), {
      contentType: "image/webp",
    });
    expect(await storage.deleteAllVersions(prefix)).toBe(2);
    expect(await storage.head(original)).toBeNull();
  });
});

describe("S3 driver", () => {
  const client = new S3Client({
    region: "ca-central-1",
    credentials: { accessKeyId: "AKIDEXAMPLE", secretAccessKey: "secret" },
    requestChecksumCalculation: "WHEN_REQUIRED",
  });
  const storage = s3PhotoStorage({ client, bucket: "daybell-staging-ca-photos" });

  afterEach(() => vi.restoreAllMocks());

  it("signs each part's exact length into its URL, with IDs only in it, and no checksum", async () => {
    const url = new URL(await storage.presignPart(original, "upload-1", 2, 1234, 900));
    expect(url.host).toBe("daybell-staging-ca-photos.s3.ca-central-1.amazonaws.com");
    expect(url.pathname).toBe(`/${original}`);
    expect(url.searchParams.get("X-Amz-SignedHeaders")).toBe("content-length;host");
    expect(url.searchParams.get("X-Amz-Expires")).toBe("900");
    expect(url.searchParams.get("partNumber")).toBe("2");
    expect([...url.searchParams.keys()].some((k) => k.toLowerCase().includes("checksum"))).toBe(
      false,
    );
  });

  it("signs reads at a given time, so a URL can stay the same for an hour", async () => {
    const signedAt = new Date("2026-10-11T12:00:00Z");
    const a = await storage.presignGet(photoKey(ids, "thumb.webp"), { expiresIn: 7200, signedAt });
    const b = await storage.presignGet(photoKey(ids, "thumb.webp"), { expiresIn: 7200, signedAt });
    expect(a).toBe(b);
    expect(new URL(a).searchParams.get("X-Amz-Date")).toBe("20261011T120000Z");
  });

  it("lists every part page, and completes with what S3 has", async () => {
    const send = vi.spyOn(client, "send");
    send
      .mockResolvedValueOnce({
        Parts: [{ PartNumber: 2, Size: 5, ETag: '"b"' }],
        IsTruncated: true,
        NextPartNumberMarker: "2",
      } as never)
      .mockResolvedValueOnce({ Parts: [{ PartNumber: 1, Size: 8, ETag: '"a"' }] } as never);
    expect(await storage.listParts(original, "u")).toEqual([
      { partNumber: 1, size: 8, etag: '"a"' },
      { partNumber: 2, size: 5, etag: '"b"' },
    ]);
    expect((send.mock.calls[1] as unknown as [{ input: object }])[0].input).toMatchObject({
      PartNumberMarker: "2",
    });
  });

  it("deletes every version and delete marker under a photo's folder", async () => {
    const send = vi.spyOn(client, "send");
    send
      .mockResolvedValueOnce({
        Versions: [
          { Key: original, VersionId: "v1" },
          { Key: original, VersionId: "v2" },
        ],
        DeleteMarkers: [{ Key: photoKey(ids, "thumb.webp"), VersionId: "m1" }],
        IsTruncated: false,
      } as never)
      .mockResolvedValueOnce({} as never);
    expect(await storage.deleteAllVersions(prefix)).toBe(3);
    const [del] = send.mock.calls[1] as unknown as [{ input: { Delete: { Objects: unknown[] } } }];
    expect(del.input.Delete.Objects).toHaveLength(3);
    await expect(storage.deleteAllVersions(original)).rejects.toThrow("invalid_key");
  });

  it("finds an object's size by listing (no read permission on originals), null when it's missing", async () => {
    const send = vi.spyOn(client, "send");
    send.mockResolvedValueOnce({ Contents: [{ Key: original, Size: 42 }] } as never);
    expect(await storage.head(original)).toEqual({ size: 42 });
    expect(
      (send.mock.calls[0] as unknown as [{ constructor: { name: string } }])[0].constructor.name,
    ).toBe("ListObjectsV2Command");
    send.mockResolvedValueOnce({ Contents: [{ Key: `${original}-other`, Size: 1 }] } as never);
    expect(await storage.head(original)).toBeNull();
    await expect(storage.head("../x")).rejects.toThrow("invalid_key");
  });

  it("says an upload that was completed or aborted is not found", async () => {
    vi.spyOn(client, "send").mockRejectedValueOnce(
      Object.assign(new Error("x"), { name: "NoSuchUpload" }) as never,
    );
    await expect(storage.listParts(original, "gone")).rejects.toThrow("not_found");
  });

  it("never signs a read for longer than its credentials last (review CR13)", async () => {
    const signedAt = new Date("2026-10-11T12:00:00Z");
    const short = new S3Client({
      region: "ca-central-1",
      credentials: async () => ({
        accessKeyId: "AKIDEXAMPLE",
        secretAccessKey: "secret",
        sessionToken: "token",
        expiration: new Date(signedAt.getTime() + 10 * 60_000),
      }),
    });
    const url = await s3PhotoStorage({ client: short, bucket: "b" }).presignGet(
      photoKey(ids, "thumb.webp"),
      { expiresIn: 3600, signedAt },
    );
    expect(new URL(url).searchParams.get("X-Amz-Expires")).toBe("570");
  });
});
