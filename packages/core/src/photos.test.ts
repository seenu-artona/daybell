import { describe, expect, it } from "vitest";
import {
  baseName,
  compareTaggingOrder,
  compareUtf8,
  exifCaptureTime,
  filterUploadFiles,
  MAX_PHOTO_BYTES,
  PART_BYTES,
  parsePhotoKey,
  partLength,
  partRange,
  partsComplete,
  photoKey,
  photoPrefix,
  planParts,
  signWorkerRequest,
  skipReason,
  type TaggingOrderFields,
  verifyWorkerRequest,
} from "./photos";

const S = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const J = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const P = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";

describe("which files are uploaded", () => {
  it("takes JPEGs of any case and skips hidden files and folders quietly", () => {
    expect(skipReason({ name: "Day 1/IMG_0001.JPG", size: 10 })).toBeNull();
    expect(skipReason({ name: "a.jpeg", size: 10 })).toBeNull();
    expect(skipReason({ name: "._IMG_0001.JPG", size: 10 })).toBe("hidden");
    expect(skipReason({ name: ".DS_Store", size: 10 })).toBe("hidden");
    expect(skipReason({ name: "card/.thumbnails/x.jpg", size: 10 })).toBe("hidden");
    expect(skipReason({ name: "x.png", size: 10 })).toBe("notJpeg");
    expect(skipReason({ name: "x.CR3", size: 10 })).toBe("notJpeg");
    expect(skipReason({ name: "x.jpg.zip", size: 10 })).toBe("notJpeg");
  });

  it("skips empty files and files over 50 MB", () => {
    expect(skipReason({ name: "x.jpg", size: 0 })).toBe("empty");
    expect(skipReason({ name: "x.jpg", size: MAX_PHOTO_BYTES })).toBeNull();
    expect(skipReason({ name: "x.jpg", size: MAX_PHOTO_BYTES + 1 })).toBe("tooLarge");
  });

  it("counts skipped files by reason, but not hidden ones", () => {
    const { accepted, skipped } = filterUploadFiles([
      { name: "a.jpg", size: 1 },
      { name: "b.png", size: 1 },
      { name: ".DS_Store", size: 1 },
      { name: "c.jpg", size: MAX_PHOTO_BYTES + 1 },
      { name: "d.jpg", size: 0 },
    ]);
    expect(accepted.map((f) => f.name)).toEqual(["a.jpg"]);
    expect(skipped).toEqual({ notJpeg: 1, tooLarge: 1, empty: 1 });
  });

  it("keeps only the file's own name, without control characters, at most 255 characters", () => {
    expect(baseName("Day 1/IMG_0001.JPG")).toBe("IMG_0001.JPG");
    expect(baseName("a\u0000b.jpg")).toBe("ab.jpg");
    expect(Array.from(baseName(`${"😀".repeat(300)}.jpg`))).toHaveLength(255);
  });
});

describe("parts", () => {
  it("cuts a file into 8 MiB parts, the last one shorter", () => {
    expect(planParts(1)).toEqual({ partSize: PART_BYTES, partCount: 1 });
    expect(planParts(PART_BYTES)).toEqual({ partSize: PART_BYTES, partCount: 1 });
    expect(planParts(PART_BYTES + 1)).toEqual({ partSize: PART_BYTES, partCount: 2 });
    expect(planParts(MAX_PHOTO_BYTES).partCount).toBe(7);
    expect(partLength(PART_BYTES + 5, 1)).toBe(PART_BYTES);
    expect(partLength(PART_BYTES + 5, 2)).toBe(5);
    expect(partRange(PART_BYTES + 5, 2)).toEqual({ start: PART_BYTES, end: PART_BYTES + 5 });
  });

  it("refuses sizes and parts that can't exist", () => {
    expect(() => planParts(0)).toThrow();
    expect(() => planParts(MAX_PHOTO_BYTES + 1)).toThrow();
    expect(() => planParts(1.5)).toThrow();
    expect(() => partLength(10, 2)).toThrow();
    expect(() => partLength(10, 0)).toThrow();
  });

  it("knows when the uploaded parts make the whole file", () => {
    const size = PART_BYTES * 2 + 3;
    const whole = [
      { partNumber: 1, size: PART_BYTES },
      { partNumber: 2, size: PART_BYTES },
      { partNumber: 3, size: 3 },
    ];
    expect(partsComplete(size, whole)).toBe(true);
    expect(partsComplete(size, whole.slice(0, 2))).toBe(false);
    expect(partsComplete(size, [...whole.slice(0, 2), { partNumber: 3, size: 4 }])).toBe(false);
    expect(partsComplete(size, [whole[0], whole[0], whole[2]] as typeof whole)).toBe(false);
  });
});

describe("object keys", () => {
  it("hold IDs only", () => {
    expect(photoKey({ studioId: S, jobId: J, photoId: P }, "original")).toBe(
      `${S}/${J}/${P}/original`,
    );
    expect(photoPrefix({ studioId: S, jobId: J, photoId: P })).toBe(`${S}/${J}/${P}/`);
    expect(() => photoKey({ studioId: "IMG_0001", jobId: J, photoId: P }, "original")).toThrow();
    expect(() =>
      photoKey({ studioId: S.toUpperCase(), jobId: J, photoId: P }, "original"),
    ).toThrow();
    expect(() => photoKey({ studioId: `${S}/..`, jobId: J, photoId: P }, "original")).toThrow();
  });

  it("parse back, and anything else is not a photo key", () => {
    expect(parsePhotoKey(`${S}/${J}/${P}/proof.webp`)).toEqual({
      studioId: S,
      jobId: J,
      photoId: P,
      variant: "proof.webp",
    });
    expect(parsePhotoKey(`${S}/${J}/${P}/original/x`)).toBeNull();
    expect(parsePhotoKey(`${S}/${J}/${P}/secret.jpg`)).toBeNull();
    expect(parsePhotoKey(`${S}/${J}/IMG_0001.JPG/original`)).toBeNull();
    expect(parsePhotoKey("")).toBeNull();
  });
});

describe("tagging order (Seenu, answer 2; D142 answers 5 and 7)", () => {
  const photo = (
    id: string,
    batchSeq: number,
    capturedAt: string | null,
    originalFilename: string,
  ): TaggingOrderFields => ({ id, batchSeq, capturedAt, originalFilename });

  it("sorts by batch, then capture time, then filename; untimed photos last in their batch", () => {
    const photos = [
      photo("1", 2, "2026-10-01T09:00:00", "A.JPG"),
      photo("2", 1, null, "B.JPG"),
      photo("3", 1, "2026-10-01T09:00:00.50", "Z.JPG"),
      photo("4", 1, "2026-10-01T09:00:00.05", "Y.JPG"),
      photo("5", 1, null, "A.JPG"),
      photo("6", 1, "2026-10-01T09:00:00.50", "M.JPG"),
    ];
    expect(photos.sort(compareTaggingOrder).map((p) => p.id)).toEqual([
      "4",
      "6",
      "3",
      "5",
      "2",
      "1",
    ]);
  });

  it('compares names byte by byte, as Postgres does with COLLATE "C"', () => {
    expect(compareUtf8("B", "a")).toBeLessThan(0);
    expect(compareUtf8("IMG_10", "IMG_9")).toBeLessThan(0);
    // UTF-16 order would put U+FF21 after U+1F600's surrogates; UTF-8 bytes put it first.
    expect(compareUtf8("Ａ", "😀")).toBeLessThan(0);
    expect(compareUtf8("a", "a")).toBe(0);
  });

  it("reads EXIF capture time with sub-seconds, as written by the camera", () => {
    const at = new Date(Date.UTC(2026, 9, 1, 9, 30, 5));
    expect(exifCaptureTime(at, "47")).toBe("2026-10-01T09:30:05.47");
    expect(exifCaptureTime(at, " 470 ")).toBe("2026-10-01T09:30:05.470");
    expect(exifCaptureTime(at, 7)).toBe("2026-10-01T09:30:05.7");
    expect(exifCaptureTime(at, null)).toBe("2026-10-01T09:30:05");
    expect(exifCaptureTime(at, "abc")).toBe("2026-10-01T09:30:05");
    expect(exifCaptureTime(new Date(Number.NaN))).toBeNull();
    expect(exifCaptureTime(new Date(Date.UTC(1800, 0, 1)))).toBeNull();
    expect(exifCaptureTime(undefined)).toBeNull();
  });
});

describe("signed worker requests", () => {
  const secret = "s".repeat(32);
  const other = "o".repeat(32);
  const req = {
    method: "POST",
    path: `/api/v1/internal/photo-worker/photos/${P}/result`,
    region: "ca",
    body: '{"status":"ready"}',
  };
  const now = 1_800_000_000;

  it("verifies a genuine request", async () => {
    const header = await signWorkerRequest(secret, req, now);
    expect(header).toMatch(/^t=1800000000,v1=[0-9a-f]{64}$/);
    expect(await verifyWorkerRequest([secret], header, req, now)).toBe(true);
  });

  it("refuses tampering with the body, path, method or region", async () => {
    const header = await signWorkerRequest(secret, req, now);
    for (const changed of [
      { ...req, body: '{"status":"failed"}' },
      { ...req, path: req.path.replace(P, S) },
      { ...req, method: "GET" },
      { ...req, region: "us" },
    ])
      expect(await verifyWorkerRequest([secret], header, changed, now)).toBe(false);
    const forged = header.replace(/v1=./, (m) => `${m.slice(0, -1)}${m.endsWith("0") ? "1" : "0"}`);
    expect(await verifyWorkerRequest([secret], forged, req, now)).toBe(false);
  });

  it("allows 5 minutes of clock skew, no more", async () => {
    const header = await signWorkerRequest(secret, req, now);
    expect(await verifyWorkerRequest([secret], header, req, now + 300)).toBe(true);
    expect(await verifyWorkerRequest([secret], header, req, now - 300)).toBe(true);
    expect(await verifyWorkerRequest([secret], header, req, now + 301)).toBe(false);
  });

  it("accepts either of two secrets while one is rotated out", async () => {
    const header = await signWorkerRequest(other, req, now);
    expect(await verifyWorkerRequest([secret, other], header, req, now)).toBe(true);
    expect(await verifyWorkerRequest([secret], header, req, now)).toBe(false);
  });

  it("refuses missing or malformed headers and short secrets", async () => {
    expect(await verifyWorkerRequest([secret], null, req, now)).toBe(false);
    expect(await verifyWorkerRequest([secret], "v1=abc", req, now)).toBe(false);
    await expect(signWorkerRequest("short", req, now)).rejects.toThrow();
    const header = await signWorkerRequest(secret, req, now);
    expect(await verifyWorkerRequest(["short"], header, req, now)).toBe(false);
  });
});
