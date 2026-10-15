import { execFileSync } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Writable } from "node:stream";
import {
  DRM_CLIP_FRAMES,
  DRM_VARIANTS,
  H264_LEVEL_40_MAX_MACROBLOCKS,
  photoKey,
  rewriteDashManifest,
  rewriteHlsMedia,
} from "@daybell/core";
import sharp from "sharp";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  type DrmClip,
  type DrmJobDeps,
  DrmPackagingError,
  drmFrame,
  drmPlatform,
  ffmpegArgs,
  packageDrmClip,
  packagerArgs,
  type RunTool,
  runDrmJob,
  scrub,
  toolEnv,
  verifyDrmBinaries,
  type WorkerPhoto,
  writeFrames,
} from "./index";

vi.setConfig({ testTimeout: 60_000 });

const KEY_ID = "2b0e6a4c-9f6e-4f0a-8d2b-3c4d5e6f7a8b";

async function webp(width: number, height: number): Promise<Uint8Array> {
  const raw = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) {
    raw[i * 3] = (i % width) % 256;
    raw[i * 3 + 1] = Math.floor(i / width) % 256;
    raw[i * 3 + 2] = 90;
  }
  return new Uint8Array(
    await sharp(raw, { raw: { width, height, channels: 3 } })
      .webp({ quality: 80 })
      .toBuffer(),
  );
}

describe("the tools' arguments", () => {
  it("ffmpeg: raw RGB on stdin, H.264 High 4.0, 10 frames at 5 fps, one IDR then P frames, BT.709 limited", () => {
    const args = ffmpegArgs({ width: 1600, height: 1066 }, "/tmp/x/clear.mp4");
    const argAfter = (flag: string) => args[args.indexOf(flag) + 1];
    expect(argAfter("-video_size")).toBe("1600x1066");
    expect(argAfter("-framerate")).toBe("5");
    expect(argAfter("-i")).toBe("pipe:0");
    expect(argAfter("-frames:v")).toBe(String(DRM_CLIP_FRAMES));
    expect(argAfter("-profile:v")).toBe("high");
    expect(argAfter("-level:v")).toBe("4.0");
    expect(argAfter("-g")).toBe("10");
    expect(argAfter("-bf")).toBe("0");
    expect(argAfter("-x264-params")).toBe("keyint=10:min-keyint=10:scenecut=0:open-gop=0");
    expect(argAfter("-colorspace")).toBe("bt709");
    expect(argAfter("-color_range")).toBe("tv");
    expect(argAfter("-map_metadata")).toBe("-1");
    expect(args.at(-1)).toBe("/tmp/x/clear.mp4");
  });

  it("Shaka Packager: cbcs, the IV equal to the key ID's bytes, no clear lead, three systems, skd://<key ID>", () => {
    const args = packagerArgs({
      dir: "/tmp/x",
      input: "/tmp/x/clear.mp4",
      keyId: KEY_ID,
      keyHex: "00".repeat(16),
    });
    const argAfter = (flag: string) => args[args.indexOf(flag) + 1];
    expect(args[0]).toBe(
      "in=/tmp/x/clear.mp4,stream=video,output=/tmp/x/drm.mp4,playlist_name=drm-video.m3u8",
    );
    expect(argAfter("--protection_scheme")).toBe("cbcs");
    expect(argAfter("--keys")).toBe(
      `label=:key_id=2b0e6a4c9f6e4f0a8d2b3c4d5e6f7a8b:key=${"00".repeat(16)}:iv=2b0e6a4c9f6e4f0a8d2b3c4d5e6f7a8b`,
    );
    expect(argAfter("--clear_lead")).toBe("0");
    expect(argAfter("--protection_systems")).toBe("Widevine,PlayReady,FairPlay");
    expect(argAfter("--hls_key_uri")).toBe(`skd://${KEY_ID}`);
    expect(argAfter("--mpd_output")).toBe("/tmp/x/drm.mpd");
    expect(argAfter("--hls_master_playlist_output")).toBe("/tmp/x/drm.m3u8");
    expect(argAfter("--hls_playlist_type")).toBe("VOD");
    expect(() =>
      packagerArgs({ dir: "/x", input: "/x/c", keyId: "nope", keyHex: "00".repeat(16) }),
    ).toThrow();
    expect(() => packagerArgs({ dir: "/x", input: "/x/c", keyId: KEY_ID, keyHex: "zz" })).toThrow();
  });

  it("each tool gets PATH and nothing else", () => {
    expect(
      toolEnv({ PATH: "/usr/bin", AWS_SECRET_ACCESS_KEY: "x", SHOP_DRM_COM_KEY: "y" }),
    ).toEqual({
      PATH: "/usr/bin",
    });
  });
});

describe("scrub", () => {
  it("takes the key out in hex (any case, GUID dashes), base64 and base64url, padded or not", () => {
    const key = "fb7f3e0a9c1d4e5fa0b1c2d3e4f5a6b7";
    const b = Buffer.from(key, "hex");
    const dashed = `${key.slice(0, 8)}-${key.slice(8, 12)}-${key.slice(12, 16)}-${key.slice(16, 20)}-${key.slice(20)}`;
    const text = [
      key.toUpperCase(),
      dashed,
      b.toString("base64"),
      b.toString("base64url"),
      b.toString("base64").replace(/=+$/, ""),
    ].join(" | ");
    const out = scrub(text, [key]);
    expect(out).toBe("<redacted> | <redacted> | <redacted> | <redacted> | <redacted>");
    expect(scrub("nothing secret", [key])).toBe("nothing secret");
  });
});

describe("the pinned binaries", () => {
  it("refuses a binary that isn't the pinned release, and platforms without a pin", async () => {
    const read = async () => new Uint8Array([1, 2, 3]);
    await expect(
      verifyDrmBinaries(
        { ffmpeg: "/opt/bin/ffmpeg", packager: "/opt/bin/packager" },
        "linux-arm64",
        read,
      ),
    ).rejects.toThrow(/^drm_ffmpeg_hash_mismatch$/);
    await expect(verifyDrmBinaries({ ffmpeg: "/a", packager: "/b" }, null, read)).rejects.toThrow(
      /^drm_platform_unsupported$/,
    );
    expect(drmPlatform("linux", "arm64")).toBe("linux-arm64");
    expect(drmPlatform("linux", "x64")).toBe("linux-x64");
    expect(drmPlatform("darwin", "arm64")).toBeNull();
  });
});

describe("drmFrame", () => {
  it("decodes the proof to raw RGB at the clip's size", async () => {
    const decoded = await drmFrame(await webp(1600, 1067));
    expect(decoded).toMatchObject({ ok: true, frame: { width: 1600, height: 1066 } });
    if (decoded.ok) expect(decoded.frame.rgb.length).toBe(1600 * 1066 * 3);
  });

  it("shrinks a square proof to level 4.0", async () => {
    const decoded = await drmFrame(await webp(1600, 1600));
    expect(decoded.ok).toBe(true);
    if (decoded.ok)
      expect(
        Math.ceil(decoded.frame.width / 16) * Math.ceil(decoded.frame.height / 16),
      ).toBeLessThanOrEqual(H264_LEVEL_40_MAX_MACROBLOCKS);
  });

  it("refuses what isn't a picture, or is too big to be a proof", async () => {
    expect(await drmFrame(new Uint8Array([1, 2, 3, 4]))).toEqual({
      ok: false,
      reason: "unreadable",
    });
    expect(await drmFrame(new Uint8Array(21 * 1024 * 1024))).toEqual({
      ok: false,
      reason: "too_large",
    });
  });
});

describe("writeFrames", () => {
  it("writes the frame the asked number of times, waiting when the pipe is full", async () => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
      highWaterMark: 4,
      write(chunk, _enc, done) {
        chunks.push(chunk as Buffer);
        setTimeout(done, 1);
      },
    });
    const finished = new Promise((ok) => sink.on("finish", ok));
    writeFrames(sink, Buffer.from("frame"), 10);
    await finished;
    expect(chunks.length).toBe(10);
  });
});

describe("packageDrmClip with fake tools", () => {
  const frame = { rgb: Buffer.alloc(16 * 16 * 3, 7), width: 16, height: 16 };
  const key = randomBytes(16);
  const keyHex = key.toString("hex");

  /** Pretends to be ffmpeg and the packager: writes the four outputs where the packager would. */
  const fakeRun = (overrides: { ffmpeg?: number; packager?: number; stderr?: string } = {}) => {
    const calls: {
      command: string;
      args: string[];
      env: Record<string, string>;
      stdinBytes: number;
    }[] = [];
    const run: RunTool = async (command, args, options) => {
      let stdinBytes = 0;
      if (options.input) {
        const sink = new Writable({
          write(chunk, _e, done) {
            stdinBytes += (chunk as Buffer).length;
            done();
          },
        });
        const end = new Promise((ok) => sink.on("finish", ok));
        options.input(sink);
        await end;
      }
      calls.push({ command, args, env: options.env, stdinBytes });
      if (command === "ffmpeg")
        return { code: overrides.ffmpeg ?? 0, stderr: overrides.stderr ?? "" };
      const dir =
        (args.find((a) => a.startsWith("in=")) ?? "").split("output=")[1]?.split("/drm.mp4")[0] ??
        "";
      if ((overrides.packager ?? 0) === 0) {
        writeFileSync(join(dir, "drm.mp4"), "mp4");
        writeFileSync(join(dir, "drm.mpd"), "<MPD><BaseURL>drm.mp4</BaseURL></MPD>");
        writeFileSync(join(dir, "drm.m3u8"), "#EXTM3U\ndrm-video.m3u8\n");
        writeFileSync(join(dir, "drm-video.m3u8"), '#EXTM3U\n#EXT-X-MAP:URI="drm.mp4"\ndrm.mp4\n');
      }
      return { code: overrides.packager ?? 0, stderr: overrides.stderr ?? "" };
    };
    return { run, calls };
  };

  it("encodes 10 frames from stdin, then packages, each with PATH only, and leaves no folder behind", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "drm-test-"));
    const { run, calls } = fakeRun();
    const clip = await packageDrmClip({
      frame,
      keyId: KEY_ID,
      key,
      binaries: { ffmpeg: "ffmpeg", packager: "packager" },
      run,
      env: { PATH: "/bin", SHOP_DRM_COM_KEY: "secret" },
      tmpRoot,
    });
    expect(calls.map((c) => c.command)).toEqual(["ffmpeg", "packager"]);
    expect(calls[0]?.stdinBytes).toBe(frame.rgb.length * DRM_CLIP_FRAMES);
    for (const c of calls) expect(c.env).toEqual({ PATH: "/bin" });
    expect(Object.keys(clip.files).sort()).toEqual([...DRM_VARIANTS].sort());
    expect(clip).toMatchObject({ width: 16, height: 16 });
    expect(readdirSync(tmpRoot)).toEqual([]);
  });

  it("a failing tool's error is scrubbed of the key, and the folder still goes", async () => {
    const tmpRoot = mkdtempSync(join(tmpdir(), "drm-test-"));
    const stderr = `bad key ${keyHex} (${key.toString("base64")})`;
    for (const failing of [{ ffmpeg: 1 }, { packager: 2 }]) {
      const { run } = fakeRun({ ...failing, stderr });
      const err = await packageDrmClip({
        frame,
        keyId: KEY_ID,
        key,
        binaries: { ffmpeg: "ffmpeg", packager: "packager" },
        run,
        tmpRoot,
      }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(DrmPackagingError);
      expect((err as Error).message).not.toContain(keyHex);
      expect((err as Error).message).not.toContain(key.toString("base64"));
      expect((err as Error).message).toContain("<redacted>");
    }
    expect(readdirSync(tmpRoot)).toEqual([]);
  });
});

describe("runDrmJob (B6)", () => {
  const ids = {
    studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    jobId: "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e",
    photoId: "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f",
  };
  const ARN = "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
  const consoleSpies = () =>
    (["log", "info", "warn", "error", "debug"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation(() => {}),
    );
  afterEach(() => vi.restoreAllMocks());

  async function setup(photo: Partial<WorkerPhoto> | null = {}) {
    const proof = await webp(320, 213);
    const stored = new Map<string, Uint8Array>([[photoKey(ids, "proof.webp"), proof]]);
    const plaintext = new Uint8Array(randomBytes(16));
    const seen = {
      plaintextHex: Buffer.from(plaintext).toString("hex"),
      plaintextB64: Buffer.from(plaintext).toString("base64"),
    };
    const clip: DrmClip = {
      files: {
        "drm.mp4": new Uint8Array(1234),
        "drm.mpd": new Uint8Array(1),
        "drm.m3u8": new Uint8Array(1),
        "drm-video.m3u8": new Uint8Array(1),
      },
      width: 320,
      height: 212,
    };
    const deps = {
      photo: vi.fn(async () =>
        photo === null
          ? null
          : ({
              id: ids.photoId,
              studioId: ids.studioId,
              jobId: ids.jobId,
              status: "ready",
              sha256: "00",
              byteSize: 1,
              attempt: 1,
              studioName: "North Peak",
              drmStatus: "requested",
              drmAttempt: 4,
              ...photo,
            } as WorkerPhoto),
      ),
      head: vi.fn(async (key: string) => {
        const b = stored.get(key);
        return b ? { size: b.length } : null;
      }),
      get: vi.fn(async (key: string) => stored.get(key) as Uint8Array<ArrayBuffer>),
      put: vi.fn(async (key: string, body: Uint8Array) => void stored.set(key, body)),
      log: vi.fn(),
      dataKey: vi.fn(async () => ({
        plaintext,
        wrapped: new Uint8Array([9, 9, 9]),
        kmsKeyArn: ARN,
      })),
      packageClip: vi.fn(async (_frame: unknown, _keyId: string, key: Uint8Array) => {
        // The key reaches the packager intact…
        expect(Buffer.from(key).toString("hex")).toBe(seen.plaintextHex);
        return clip;
      }),
      reportDrm: vi.fn(async () => {}),
      newKeyId: () => KEY_ID,
    } satisfies DrmJobDeps;
    return { deps, stored, plaintext, seen };
  }

  it("packages a requested photo: the key bound to its photo, four files stored, the wrapped key reported for the attempt", async () => {
    const spies = consoleSpies();
    const { deps, stored, plaintext, seen } = await setup();
    expect(await runDrmJob(ids.photoId, deps)).toBe("ready");
    expect(deps.dataKey).toHaveBeenCalledWith({
      studio: ids.studioId,
      photo: ids.photoId,
      key: KEY_ID,
    });
    for (const v of DRM_VARIANTS) expect(stored.has(photoKey(ids, v))).toBe(true);
    expect(deps.put).toHaveBeenCalledWith(
      photoKey(ids, "drm.mp4"),
      expect.anything(),
      "video/mp4",
      "private, max-age=3600",
    );
    expect(deps.put).toHaveBeenCalledWith(
      photoKey(ids, "drm.mpd"),
      expect.anything(),
      "application/dash+xml",
      "private, max-age=3600",
    );
    expect(deps.put.mock.calls.map((c) => c[0]).at(0)).toBe(photoKey(ids, "drm.mp4"));
    expect(deps.reportDrm).toHaveBeenCalledWith(ids.photoId, {
      status: "ready",
      attempt: 4,
      keyId: KEY_ID,
      wrappedKey: Buffer.from([9, 9, 9]).toString("base64"),
      kmsKeyArn: ARN,
      width: 320,
      height: 212,
      bytes: 1234,
    });
    // …and is zeroed afterwards; never logged, stored or reported.
    expect([...plaintext].every((b) => b === 0)).toBe(true);
    const everything = JSON.stringify([
      deps.log.mock.calls,
      deps.reportDrm.mock.calls,
      [...stored.keys()],
    ]);
    expect(everything).not.toContain(seen.plaintextHex);
    expect(everything).not.toContain(seen.plaintextB64);
    expect(deps.log.mock.calls).toEqual([["drm_ready", ids.photoId]]);
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("skips a photo that isn't ready, isn't requested or is gone, without asking KMS", async () => {
    for (const photo of [
      { status: "processing" as const },
      { drmStatus: "ready" as const },
      { drmStatus: null },
      null,
    ]) {
      const { deps } = await setup(photo);
      expect(await runDrmJob(ids.photoId, deps)).toBe("skipped");
      expect(deps.dataKey).not.toHaveBeenCalled();
      expect(deps.reportDrm).not.toHaveBeenCalled();
    }
  });

  it("reports a missing or unreadable proof as failed for good, before any key is made", async () => {
    const missing = await setup();
    missing.stored.clear();
    expect(await runDrmJob(ids.photoId, missing.deps)).toBe("failed");
    expect(missing.deps.reportDrm).toHaveBeenCalledWith(ids.photoId, {
      status: "failed",
      reason: "proof_missing",
      attempt: 4,
    });
    const broken = await setup();
    broken.stored.set(photoKey(ids, "proof.webp"), new Uint8Array([1, 2, 3]));
    expect(await runDrmJob(ids.photoId, broken.deps)).toBe("failed");
    expect(broken.deps.reportDrm).toHaveBeenCalledWith(ids.photoId, {
      status: "failed",
      reason: "unreadable",
      attempt: 4,
    });
    expect(broken.deps.dataKey).not.toHaveBeenCalled();
  });

  it("lets a tool's failure through (SQS tries again), with the key zeroed and nothing stored or reported", async () => {
    const { deps, plaintext } = await setup();
    deps.packageClip.mockRejectedValueOnce(new DrmPackagingError("packager", "x"));
    await expect(runDrmJob(ids.photoId, deps)).rejects.toThrow(DrmPackagingError);
    expect([...plaintext].every((b) => b === 0)).toBe(true);
    expect(deps.put).not.toHaveBeenCalled();
    expect(deps.reportDrm).not.toHaveBeenCalled();
  });
});

// The real tools, when their paths are given (the CI job drm-packaging, or by hand): a throwaway key, a synthetic
// picture. The clip decrypts with the key to the picture and to nothing usable without it, and the key is in no file.
const FFMPEG = process.env.DRM_TEST_FFMPEG?.trim();
const PACKAGER = process.env.DRM_TEST_PACKAGER?.trim();
// CI sets DRM_TEST_REQUIRED, so a misnamed path can't make the check pass by skipping it.
it.runIf(process.env.DRM_TEST_REQUIRED === "1")("has the tools it was asked to run", () => {
  expect(FFMPEG && PACKAGER && existsSync(FFMPEG) && existsSync(PACKAGER)).toBeTruthy();
});
describe.runIf(FFMPEG && PACKAGER)("packaging with the pinned binaries", () => {
  const decode = (
    file: string,
    key: string | null,
    size: { width: number; height: number },
  ): Buffer | null => {
    try {
      return execFileSync(
        FFMPEG as string,
        [
          "-hide_banner",
          "-loglevel",
          "quiet",
          ...(key ? ["-decryption_key", key] : []),
          "-i",
          file,
          "-frames:v",
          "1",
          "-f",
          "rawvideo",
          "-pix_fmt",
          "rgb24",
          "-s",
          `${size.width}x${size.height}`,
          "pipe:1",
        ],
        { env: { PATH: process.env.PATH ?? "" }, maxBuffer: 64 * 1024 * 1024 },
      );
    } catch {
      return null;
    }
  };
  const psnr = (a: Buffer, b: Buffer) => {
    let sum = 0;
    for (let i = 0; i < a.length; i++) sum += ((a[i] ?? 0) - (b[i] ?? 0)) ** 2;
    const mse = sum / a.length;
    return mse === 0 ? Number.POSITIVE_INFINITY : 10 * Math.log10((255 * 255) / mse);
  };

  it("makes a clip that decrypts with its key only, and holds no key", async () => {
    await verifyDrmBinaries({ ffmpeg: FFMPEG as string, packager: PACKAGER as string });
    const decoded = await drmFrame(await webp(1600, 1067));
    if (!decoded.ok) throw new Error("decode");
    const key = randomBytes(16);
    const keyId = randomUUID();
    const clip = await packageDrmClip({
      frame: decoded.frame,
      keyId,
      key,
      binaries: { ffmpeg: FFMPEG as string, packager: PACKAGER as string },
    });
    const dir = mkdtempSync(join(tmpdir(), "drm-check-"));
    for (const v of DRM_VARIANTS) writeFileSync(join(dir, v), clip.files[v]);
    const mp4 = join(dir, "drm.mp4");

    const withKey = decode(mp4, key.toString("hex"), clip);
    expect(withKey).not.toBeNull();
    expect(psnr(withKey as Buffer, decoded.frame.rgb)).toBeGreaterThan(35);
    const withoutKey = decode(mp4, null, clip);
    if (withoutKey) expect(psnr(withoutKey, decoded.frame.rgb)).toBeLessThan(20);

    for (const v of DRM_VARIANTS) {
      const bytes = Buffer.from(clip.files[v]);
      expect(bytes.includes(key)).toBe(false);
      for (const form of [key.toString("hex"), key.toString("base64"), key.toString("base64url")])
        expect(bytes.toString("latin1").toLowerCase().includes(form.toLowerCase())).toBe(false);
    }
    const mpd = Buffer.from(clip.files["drm.mpd"]).toString("utf8");
    expect(mpd).toContain('codecs="avc1.640028"');
    expect(mpd).toContain('value="cbcs"');
    expect(mpd).toContain(`cenc:default_KID="${keyId}"`);
    expect(rewriteDashManifest(mpd, "https://b.example/drm.mp4?a=1&b=2")).toContain("a=1&amp;b=2");
    const media = Buffer.from(clip.files["drm-video.m3u8"]).toString("utf8");
    expect(media).toContain(`URI="skd://${keyId}"`);
    expect(media).toContain(`IV=0x${keyId.replaceAll("-", "")}`);
    expect(rewriteHlsMedia(media, "https://b.example/drm.mp4?s=1")).toContain(
      'URI="https://b.example/drm.mp4?s=1"',
    );
    expect(existsSync(dir)).toBe(true);
    expect(readFileSync(mp4).length).toBe(clip.files["drm.mp4"].length);
  });
});
