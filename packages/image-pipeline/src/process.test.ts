import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { MAX_PHOTO_BYTES, photoKey } from "@daybell/core";
import sharp from "sharp";
import { describe, expect, it, vi } from "vitest";
import {
  defaultFontFile,
  escapePango,
  type PhotoJobDeps,
  processOriginal,
  runPhotoJob,
  type WorkerPhoto,
} from "./index";

/** zxing's reader, from node_modules (the Lambda passes its own copy; ADR 0018). */
const WASM = createRequire(import.meta.url).resolve("zxing-wasm/reader/zxing_reader.wasm");
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const asBytes = (b: Buffer): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(b.byteLength);
  out.set(b);
  return out;
};

/** A JPEG made in the test: a gradient, with optional EXIF (capture time, sub-seconds, GPS) and orientation. */
async function jpeg(
  width: number,
  height: number,
  options: { exif?: boolean; orientation?: number } = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    raw[i * 3] = (i % width) % 256;
    raw[i * 3 + 1] = Math.floor(i / width) % 256;
    raw[i * 3 + 2] = 128;
  }
  let image = sharp(raw, { raw: { width, height, channels: 3 } });
  if (options.exif)
    image = image.withExif({
      IFD0: { Make: "Test", Model: "Camera" },
      IFD2: { DateTimeOriginal: "2026:10:01 09:30:05", SubSecTimeOriginal: "47" },
      IFD3: { GPSLatitudeRef: "N", GPSLatitude: "45/1 30/1 0/1" },
    });
  if (options.orientation) image = image.withMetadata({ orientation: options.orientation });
  return asBytes(await image.jpeg({ quality: 85 }).toBuffer());
}

const studioName = "North Peak & <Co>";

describe("processOriginal (D60, D100)", () => {
  it("makes four upright WebP previews, 400 and 1600 px, and reads the capture time to the hundredth", async () => {
    const bytes = await jpeg(2400, 1600, { exif: true });
    const result = await processOriginal(bytes, {
      qrWasmFile: WASM,
      studioName,
      expectedSha256: sha(bytes),
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.facts).toEqual({
      width: 2400,
      height: 1600,
      capturedAt: "2026-10-01T09:30:05.47",
      qr: { kind: "none" },
    });
    const sizes: Record<string, [number, number]> = {};
    for (const [variant, body] of Object.entries(result.derivatives)) {
      const meta = await sharp(body).metadata();
      expect(meta.format).toBe("webp");
      // Every bit of metadata is stripped: no EXIF, no GPS, no camera.
      expect(meta.exif).toBeUndefined();
      expect(meta.xmp).toBeUndefined();
      expect(meta.iptc).toBeUndefined();
      expect(meta.icc).toBeUndefined();
      sizes[variant] = [meta.width ?? 0, meta.height ?? 0];
    }
    expect(sizes).toEqual({
      "thumb.webp": [400, 267],
      "view.webp": [1600, 1067],
      "proof-thumb.webp": [400, 267],
      "proof.webp": [1600, 1067],
    });
  });

  it("turns photos upright by their EXIF orientation", async () => {
    const bytes = await jpeg(600, 300, { orientation: 6 });
    const result = await processOriginal(bytes, {
      qrWasmFile: WASM,
      studioName,
      expectedSha256: sha(bytes),
    });
    if (!result.ok) throw new Error(result.reason);
    expect([result.facts.width, result.facts.height]).toEqual([300, 600]);
    const thumb = await sharp(result.derivatives["thumb.webp"]).metadata();
    expect([thumb.width, thumb.height]).toEqual([200, 400]);
  });

  it("never enlarges small photos, and leaves untimed photos untimed", async () => {
    const bytes = await jpeg(120, 30);
    const result = await processOriginal(bytes, {
      qrWasmFile: WASM,
      studioName,
      expectedSha256: sha(bytes),
    });
    if (!result.ok) throw new Error(result.reason);
    expect(result.facts.capturedAt).toBeNull();
    const proof = await sharp(result.derivatives["proof.webp"]).metadata();
    expect([proof.width, proof.height]).toEqual([120, 30]);
  });

  it("watermarks only the parents' previews", async () => {
    const bytes = await jpeg(1600, 1200);
    const result = await processOriginal(bytes, {
      qrWasmFile: WASM,
      studioName,
      expectedSha256: sha(bytes),
    });
    if (!result.ok) throw new Error(result.reason);
    const pixels = async (b: Buffer) => sharp(b).raw().toBuffer();
    const [plain, proof] = await Promise.all([
      pixels(result.derivatives["view.webp"]),
      pixels(result.derivatives["proof.webp"]),
    ]);
    let changed = 0;
    for (let i = 0; i < plain.length; i++)
      if (Math.abs((plain[i] as number) - (proof[i] as number)) > 24) changed++;
    // The tiled name covers part of the photo, lightly (about 30% opacity).
    expect(changed / plain.length).toBeGreaterThan(0.005);
    expect(changed / plain.length).toBeLessThan(0.4);
  });

  it("refuses a file that isn't what the browser hashed", async () => {
    const bytes = await jpeg(10, 10);
    expect(
      await processOriginal(bytes, {
        qrWasmFile: WASM,
        studioName,
        expectedSha256: "0".repeat(64),
      }),
    ).toEqual({
      ok: false,
      reason: "hash_mismatch",
    });
  });

  it("refuses anything but JPEG, and broken JPEGs", async () => {
    const png = asBytes(
      await sharp({ create: { width: 4, height: 4, channels: 3, background: "#fff" } })
        .png()
        .toBuffer(),
    );
    expect(
      await processOriginal(png, { qrWasmFile: WASM, studioName, expectedSha256: sha(png) }),
    ).toEqual({
      ok: false,
      reason: "not_jpeg",
    });
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]);
    expect(
      await processOriginal(broken, { qrWasmFile: WASM, studioName, expectedSha256: sha(broken) }),
    ).toEqual({
      ok: false,
      reason: "unreadable",
    });
  });

  it("refuses a large progressive JPEG (a decompression bomb) from its header, before decoding it", async () => {
    // 8,000 × 7,600 = 60.8 million pixels, over the progressive limit; a plain colour, so the file stays small.
    const bomb = asBytes(
      await sharp({ create: { width: 8000, height: 7600, channels: 3, background: "#888" } })
        .jpeg({ progressive: true, quality: 50 })
        .toBuffer(),
    );
    expect(bomb.length).toBeLessThan(5_000_000);
    const started = Date.now();
    expect(
      await processOriginal(bomb, { qrWasmFile: WASM, studioName, expectedSha256: sha(bomb) }),
    ).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(Date.now() - started).toBeLessThan(5000);
  }, 60_000);

  it("refuses originals over the pixel limit, baseline or progressive", async () => {
    const baseline = await jpeg(200, 100);
    const options = { studioName, expectedSha256: sha(baseline) };
    expect(
      await processOriginal(baseline, { qrWasmFile: WASM, ...options, maxPixels: 19_999 }),
    ).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect(
      (await processOriginal(baseline, { qrWasmFile: WASM, ...options, maxPixels: 20_000 })).ok,
    ).toBe(true);
    const progressive = asBytes(
      await sharp({ create: { width: 200, height: 100, channels: 3, background: "#468" } })
        .jpeg({ progressive: true })
        .toBuffer(),
    );
    const p = { studioName, expectedSha256: sha(progressive), qrWasmFile: WASM };
    expect(await processOriginal(progressive, { ...p, maxProgressivePixels: 19_999 })).toEqual({
      ok: false,
      reason: "too_large",
    });
    expect((await processOriginal(progressive, p)).ok).toBe(true);
  });

  it("refuses files over 50 MB before hashing them", async () => {
    const big = new Uint8Array(MAX_PHOTO_BYTES + 1);
    expect(
      await processOriginal(big, { qrWasmFile: WASM, studioName, expectedSha256: "0".repeat(64) }),
    ).toEqual({
      ok: false,
      reason: "too_large",
    });
  });

  it("escapes the studio's name for the text renderer", () => {
    expect(escapePango(`A&B <i>"x"</i> 'y'\u0007`)).toBe(
      "A&amp;B &lt;i&gt;&quot;x&quot;&lt;/i&gt; &apos;y&apos;",
    );
  });

  it("draws with the bundled font, whose file is the one checked in", () => {
    expect(createHash("sha256").update(readFileSync(defaultFontFile())).digest("hex")).toBe(
      "5f5342ef76862b5b5365d1dff1a667629dfa484e388dd602552f647219c3870f",
    );
  });
});

describe("runPhotoJob", () => {
  const ids = {
    studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
    photoId: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
  };

  async function setup(photo: Partial<WorkerPhoto> | null, bytes?: Uint8Array<ArrayBuffer>) {
    const original = bytes ?? (await jpeg(800, 600, { exif: true }));
    const stored = new Map<string, Uint8Array>([[photoKey(ids, "original"), original]]);
    const deps = {
      photo: vi.fn(async (_id: string) =>
        photo === null
          ? null
          : {
              id: ids.photoId,
              studioId: ids.studioId,
              jobId: ids.jobId,
              status: "processing" as const,
              sha256: sha(original),
              byteSize: original.length,
              attempt: 1,
              studioName,
              ...photo,
            },
      ),
      head: vi.fn(async (key: string) => {
        const b = stored.get(key);
        return b ? { size: b.length } : null;
      }),
      get: vi.fn(async (key: string) => stored.get(key) as Uint8Array<ArrayBuffer>),
      put: vi.fn(async (key: string, body: Uint8Array) => void stored.set(key, body)),
      report: vi.fn(async () => {}),
      log: vi.fn(),
      sleep: vi.fn(async (_ms: number) => {}),
    } satisfies PhotoJobDeps;
    return { deps, stored };
  }

  it("stores the four previews under ID-only keys and reports the facts", async () => {
    const { deps, stored } = await setup({});
    expect(await runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).toBe("ready");
    expect([...stored.keys()].sort()).toEqual(
      ["original", "proof-thumb.webp", "proof.webp", "thumb.webp", "view.webp"].map(
        (v) => `${ids.studioId}/${ids.jobId}/${ids.photoId}/${v}`,
      ),
    );
    expect(deps.put).toHaveBeenCalledWith(
      expect.stringMatching(/view\.webp$/),
      expect.anything(),
      "image/webp",
      "private, max-age=3600",
    );
    expect(deps.report).toHaveBeenCalledWith(ids.photoId, {
      status: "ready",
      width: 800,
      height: 600,
      capturedAt: "2026-10-01T09:30:05.47",
      qr: { kind: "none" },
      attempt: 1,
    });
    // Logs carry the photo's id and a reason only, never the studio's name.
    expect(JSON.stringify(deps.log.mock.calls)).not.toContain("North Peak");
  });

  it("does nothing for a photo that isn't processing (a repeated message) or is gone", async () => {
    for (const photo of [{ status: "ready" as const }, null]) {
      const { deps } = await setup(photo);
      expect(await runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).toBe("skipped");
      expect(deps.get).not.toHaveBeenCalled();
      expect(deps.report).not.toHaveBeenCalled();
    }
  });

  it("fails a photo whose stored size isn't the declared one, without reading it", async () => {
    const { deps } = await setup({ byteSize: 1 });
    expect(await runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).toBe("failed");
    expect(deps.get).not.toHaveBeenCalled();
    expect(deps.report).toHaveBeenCalledWith(ids.photoId, {
      status: "failed",
      failureReason: "hash_mismatch",
      attempt: 1,
    });
  });

  it("waits for a photo S3 announced before the API marked it uploaded, then hands it back to the queue", async () => {
    const { deps } = await setup({ status: "uploading" });
    await expect(runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).rejects.toThrow(
      "photo_not_uploaded_yet",
    );
    expect(deps.photo).toHaveBeenCalledTimes(4);
    expect(deps.sleep).toHaveBeenCalledTimes(3);
    expect(deps.report).not.toHaveBeenCalled();
  });

  it("carries on once the photo is marked uploaded", async () => {
    const { deps } = await setup({});
    const processing = await deps.photo(ids.photoId);
    deps.photo.mockResolvedValueOnce({ ...(processing as WorkerPhoto), status: "uploading" });
    expect(await runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).toBe("ready");
    expect(deps.sleep).toHaveBeenCalledTimes(1);
  });

  it("fails a photo over 50 MB without reading it", async () => {
    const { deps } = await setup({});
    deps.head.mockResolvedValueOnce({ size: MAX_PHOTO_BYTES + 1 });
    expect(await runPhotoJob(ids.photoId, deps, { qrWasmFile: WASM })).toBe("failed");
    expect(deps.get).not.toHaveBeenCalled();
  });
});
