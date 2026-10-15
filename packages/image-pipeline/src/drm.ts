import { type ChildProcess, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  DRM_CLIP_FPS,
  DRM_CLIP_FRAMES,
  DRM_VARIANTS,
  type DrmFailureReason,
  type DrmVariant,
  drmClipSize,
  drmIvHex,
  isDrmKeyId,
} from "@daybell/core";
import sharp from "sharp";

/**
 * Packages a photo's large view for DRM (D158; ADR 0034): its watermarked proof.webp (B1: the same pixels as the
 * WebP fallback, so D60's watermark stays) as a 2-second H.264 clip, encrypted with one content key (cbcs, no clear
 * lead) for Widevine, PlayReady and FairPlay, as one on-demand file (drm.mp4) with a DASH manifest and HLS playlists.
 *
 * - sharp decodes the proof to raw RGB at a size H.264 High level 4.0 takes (drmClipSize);
 * - ffmpeg (libx264) encodes it from stdin: 10 frames at 5 fps, one IDR frame and 9 identical P frames, BT.709 limited
 *   range, tagged as such, no metadata;
 * - Shaka Packager 3.9.3 encrypts with a raw key whose IV is the key ID's bytes (the spike's FairPlay finding).
 *
 * Both binaries must match their pinned SHA-256 before they run; each runs with an environment holding PATH only; its
 * error output is scrubbed of the key in every form before it goes anywhere. The key is never written to disk, logged
 * or returned. Nothing here logs.
 */

/** Where the binaries' pins come from: Shaka Packager from npm (the spike's pins), ffmpeg from a tagged static build. */
export const DRM_TOOLS = {
  packager: { name: "Shaka Packager", version: "3.9.3" },
  ffmpeg: {
    name: "FFmpeg (static GPL build with libx264, johnvansickle.com, from eugeneware/ffmpeg-static)",
    version: "7.0.2",
    releaseTag: "b6.1.1",
  },
} as const;

export type DrmPlatform = "linux-arm64" | "linux-x64";

/**
 * SHA-256 of each binary as run. Shaka Packager's are the npm package shaka-packager@3.9.3's (ADR 0032); ffmpeg's are
 * the gunzipped files of the b6.1.1 release (apps/image-worker/layer/build-layer.mjs pins the downloads too). Lambda
 * runs linux-arm64; CI's packaging check runs linux-x64 with the same versions.
 */
export const DRM_BINARY_SHA256: Record<"ffmpeg" | "packager", Record<DrmPlatform, string>> = {
  ffmpeg: {
    "linux-arm64": "6bb182d0d75d23028db82e9e4f723ca69b853d055698486e6984ddb2c06fb8ce",
    "linux-x64": "e7e7fb30477f717e6f55f9180a70386c62677ef8a4d4d1a5d948f4098aa3eb99",
  },
  packager: {
    "linux-arm64": "d3a50cecc139b54435be1bbbfba5c0ea822d9e1e7edc3531f7821fba65ceebb0",
    "linux-x64": "7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6",
  },
};

export function drmPlatform(
  platform: string = process.platform,
  arch: string = process.arch,
): DrmPlatform | null {
  if (platform !== "linux") return null;
  return arch === "arm64" ? "linux-arm64" : arch === "x64" ? "linux-x64" : null;
}

export interface DrmBinaries {
  ffmpeg: string;
  packager: string;
}

/** Throws unless both binaries are exactly the pinned releases for this platform. Checked once per path. */
const verified = new Set<string>();
export async function verifyDrmBinaries(
  binaries: DrmBinaries,
  platform: DrmPlatform | null = drmPlatform(),
  read: (path: string) => Promise<Uint8Array> = readFile,
): Promise<void> {
  if (!platform) throw new Error("drm_platform_unsupported");
  for (const tool of ["ffmpeg", "packager"] as const) {
    const path = binaries[tool];
    const key = `${tool}:${platform}:${path}`;
    if (verified.has(key)) continue;
    const actual = createHash("sha256")
      .update(await read(path))
      .digest("hex");
    if (actual !== DRM_BINARY_SHA256[tool][platform]) throw new Error(`drm_${tool}_hash_mismatch`);
    verified.add(key);
  }
}

// ── Arguments ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** ffmpeg: raw RGB frames on stdin to an H.264 High 4.0 MP4 with one IDR frame then P frames, BT.709 limited. */
export function ffmpegArgs(size: { width: number; height: number }, output: string): string[] {
  return [
    "-hide_banner",
    "-loglevel",
    "error",
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-video_size",
    `${size.width}x${size.height}`,
    "-framerate",
    String(DRM_CLIP_FPS),
    "-i",
    "pipe:0",
    "-frames:v",
    String(DRM_CLIP_FRAMES),
    "-an",
    "-vf",
    "scale=out_color_matrix=bt709:out_range=tv",
    "-c:v",
    "libx264",
    "-profile:v",
    "high",
    "-level:v",
    "4.0",
    "-pix_fmt",
    "yuv420p",
    "-g",
    String(DRM_CLIP_FRAMES),
    "-bf",
    "0",
    "-x264-params",
    `keyint=${DRM_CLIP_FRAMES}:min-keyint=${DRM_CLIP_FRAMES}:scenecut=0:open-gop=0`,
    "-crf",
    "18",
    "-color_primaries",
    "bt709",
    "-color_trc",
    "bt709",
    "-colorspace",
    "bt709",
    "-color_range",
    "tv",
    "-map_metadata",
    "-1",
    "-f",
    "mp4",
    output,
  ];
}

/**
 * Shaka Packager: cbcs with a raw key (IV = the key ID's bytes), no clear lead, Widevine, PlayReady and FairPlay
 * (skd://<key ID>), one on-demand file with a static DASH manifest and VOD HLS playlists, written in `dir`.
 */
export function packagerArgs(args: {
  dir: string;
  input: string;
  keyId: string;
  keyHex: string;
}): string[] {
  if (!isDrmKeyId(args.keyId)) throw new Error("packagerArgs needs a key ID");
  if (!/^[0-9a-f]{32}$/.test(args.keyHex)) throw new Error("packagerArgs needs a 16-byte key");
  const keyIdHex = args.keyId.replaceAll("-", "");
  const iv = drmIvHex(args.keyId);
  return [
    `in=${args.input},stream=video,output=${join(args.dir, "drm.mp4")},playlist_name=drm-video.m3u8`,
    "--protection_scheme",
    "cbcs",
    "--enable_raw_key_encryption",
    "--keys",
    `label=:key_id=${keyIdHex}:key=${args.keyHex}:iv=${iv}`,
    "--protection_systems",
    "Widevine,PlayReady,FairPlay",
    "--hls_key_uri",
    `skd://${args.keyId}`,
    "--clear_lead",
    "0",
    "--mpd_output",
    join(args.dir, "drm.mpd"),
    "--hls_master_playlist_output",
    join(args.dir, "drm.m3u8"),
    "--hls_playlist_type",
    "VOD",
    "--v=0",
    "--minloglevel=1",
  ];
}

/** A tool's environment: PATH only, so no other secret of the process is ever visible to it. */
export function toolEnv(
  env: Record<string, string | undefined> = process.env,
): Record<string, string> {
  return { PATH: env.PATH ?? "" };
}

const escapeRegExp = (text: string) => text.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Text with every form of each secret (hex) taken out: hex in any case, with or without GUID dashes, and the base64 and
 * base64url of its bytes, with or without padding. For a tool's error output, before it goes anywhere.
 */
export function scrub(text: string, secretsHex: readonly string[]): string {
  let out = String(text ?? "");
  for (const secret of secretsHex) {
    const hex = secret.replaceAll("-", "").toLowerCase();
    if (!hex || !/^[0-9a-f]+$/.test(hex) || hex.length % 2) continue;
    out = out.replace(new RegExp(hex.split("").join("-?"), "gi"), "<redacted>");
    const bytes = Buffer.from(hex, "hex");
    const forms = new Set([
      bytes.toString("base64"),
      bytes.toString("base64").replace(/=+$/, ""),
      bytes.toString("base64url"),
    ]);
    for (const form of [...forms].sort((a, b) => b.length - a.length))
      out = out.replace(new RegExp(escapeRegExp(form), "g"), "<redacted>");
  }
  return out;
}

// ── Running ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type RunTool = (
  command: string,
  args: string[],
  options: { env: Record<string, string>; input?: (stdin: NodeJS.WritableStream) => void },
) => Promise<{ code: number | null; stderr: string }>;

/** Runs a binary with no shell, the given environment only, and at most 16 KB of its error output kept. */
export const runTool: RunTool = (command, args, options) =>
  new Promise((resolve, reject) => {
    const child: ChildProcess = spawn(command, args, {
      env: options.env as NodeJS.ProcessEnv,
      shell: false,
      stdio: [options.input ? "pipe" : "ignore", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < 16_384) stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("close", (code: number | null) => resolve({ code, stderr }));
    if (options.input && child.stdin) {
      child.stdin.on("error", () => {});
      options.input(child.stdin);
    }
  });

/** A tool failed. Its message holds the tool's name and its scrubbed error output only, cut short. */
export class DrmPackagingError extends Error {
  constructor(tool: string, detail: string) {
    super(`${tool} failed: ${detail.slice(0, 500)}`);
    this.name = "DrmPackagingError";
  }
}

/** Writes the same frame `count` times, waiting whenever the pipe is full, then closes it. */
export function writeFrames(stdin: NodeJS.WritableStream, rgb: Buffer, count: number): void {
  let written = 0;
  const next = () => {
    while (written < count) {
      written += 1;
      if (!stdin.write(rgb)) {
        stdin.once("drain", next);
        return;
      }
    }
    stdin.end();
  };
  next();
}

/** The largest proof.webp read (they are about 1600 px and well under 1 MB). */
export const MAX_PROOF_BYTES = 20 * 1024 * 1024;

export interface DrmFrame {
  rgb: Buffer;
  width: number;
  height: number;
}

/** The proof decoded to raw sRGB at the clip's size, or why it can't be. */
export async function drmFrame(
  proof: Uint8Array,
): Promise<{ ok: true; frame: DrmFrame } | { ok: false; reason: DrmFailureReason }> {
  if (proof.length > MAX_PROOF_BYTES) return { ok: false, reason: "too_large" };
  try {
    const input = Buffer.from(proof.buffer, proof.byteOffset, proof.byteLength);
    const meta = await sharp(input, { failOn: "error", limitInputPixels: 4096 * 4096 }).metadata();
    if (!meta.width || !meta.height) return { ok: false, reason: "unreadable" };
    const size = drmClipSize(meta.width, meta.height);
    const { data, info } = await sharp(input, { failOn: "error", limitInputPixels: 4096 * 4096 })
      .resize(size.width, size.height, { fit: "fill" })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    if (info.channels !== 3 || info.width !== size.width || info.height !== size.height)
      return { ok: false, reason: "unreadable" };
    return { ok: true, frame: { rgb: data, width: info.width, height: info.height } };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}

export interface DrmClip {
  files: Record<DrmVariant, Uint8Array>;
  width: number;
  height: number;
}

/**
 * The encrypted clip and its manifests for one frame and one key. The clear clip exists only in a private temporary
 * folder for the moment between the two tools (the same pixels as proof.webp); the folder is removed in every case.
 */
export async function packageDrmClip(args: {
  frame: DrmFrame;
  keyId: string;
  key: Uint8Array;
  binaries: DrmBinaries;
  run?: RunTool;
  env?: Record<string, string | undefined>;
  tmpRoot?: string;
}): Promise<DrmClip> {
  if (args.key.length !== 16) throw new Error("A content key is 16 bytes");
  const run = args.run ?? runTool;
  const keyHex = Buffer.from(args.key).toString("hex");
  const secrets = [keyHex];
  const env = toolEnv(args.env);
  const dir = await mkdtemp(join(args.tmpRoot ?? tmpdir(), "drm-"));
  try {
    const clear = join(dir, "clear.mp4");
    const { frame } = args;
    const encoded = await run(args.binaries.ffmpeg, ffmpegArgs(frame, clear), {
      env,
      input: (stdin) => writeFrames(stdin, frame.rgb, DRM_CLIP_FRAMES),
    });
    if (encoded.code !== 0) throw new DrmPackagingError("ffmpeg", scrub(encoded.stderr, secrets));
    const packaged = await run(
      args.binaries.packager,
      packagerArgs({ dir, input: clear, keyId: args.keyId, keyHex }),
      { env },
    );
    if (packaged.code !== 0)
      throw new DrmPackagingError("packager", scrub(packaged.stderr, secrets));
    const files = Object.fromEntries(
      await Promise.all(
        DRM_VARIANTS.map(async (v) => [v, new Uint8Array(await readFile(join(dir, v)))] as const),
      ),
    ) as Record<DrmVariant, Uint8Array>;
    const mpd = Buffer.from(files["drm.mpd"]).toString("utf8");
    if (!mpd.includes("<BaseURL>drm.mp4</BaseURL>"))
      throw new DrmPackagingError("packager", "unexpected manifest");
    return { files, width: frame.width, height: frame.height };
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
