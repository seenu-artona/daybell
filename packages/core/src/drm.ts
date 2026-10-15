import { type PhotoKeyParts, photoPrefix } from "./photos";

/**
 * DRM in the parent shop's large view (D158; ADR 0034): the rules shared by the image worker (packaging), the API
 * (tokens, manifests, the cron) and the viewer. Framework-free; no keys ever pass through here.
 */

// ── The clip ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** H.264 High, level 4.0: what every hardware DRM path decodes (and the spike's clip). */
export const DRM_CODEC = "avc1.640028";
export const DRM_CODEC_MIME = `video/mp4; codecs="${DRM_CODEC}"`;

/** Level 4.0's frame size limit (MaxFS) in 16×16 macroblocks; each side is at most √(8·MaxFS) macroblocks. */
export const H264_LEVEL_40_MAX_MACROBLOCKS = 8192;
const H264_LEVEL_40_MAX_SIDE_MACROBLOCKS = Math.floor(Math.sqrt(8 * H264_LEVEL_40_MAX_MACROBLOCKS));

/** About 2 seconds at 5 frames a second: one IDR frame and 9 identical P frames (the spike's Safari fix). */
export const DRM_CLIP_FPS = 5;
export const DRM_CLIP_FRAMES = 10;

const macroblocks = (w: number, h: number) => Math.ceil(w / 16) * Math.ceil(h / 16);

/**
 * The clip's size for a proof of `width`×`height`: never larger, even on both sides (4:2:0), the same shape as near as
 * even sizes allow, and within level 4.0 (at most 8,192 macroblocks, each side at most 256 of them). A 1600×1067 proof
 * becomes 1600×1066; a 1600×1600 square shrinks to fit.
 */
export function drmClipSize(width: number, height: number): { width: number; height: number } {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 2 || height < 2)
    throw new Error("A clip needs a picture of at least 2×2 pixels");
  const maxSide = H264_LEVEL_40_MAX_SIDE_MACROBLOCKS * 16;
  let scale = Math.min(1, maxSide / width, maxSide / height);
  const even = (n: number) => Math.max(2, Math.floor(n / 2) * 2);
  let w = even(width * scale);
  let h = even(height * scale);
  while (macroblocks(w, h) > H264_LEVEL_40_MAX_MACROBLOCKS) {
    scale *= 0.99;
    w = even(width * scale);
    h = even(height * scale);
  }
  return { width: w, height: h };
}

/**
 * The packager's output files (single file, on demand): the clip and its manifests, as the packager names them and the
 * manifests refer to them. In storage each is kept under its key's own name (drmObjectKey), never these names.
 */
export const DRM_VARIANTS = ["drm.mp4", "drm.mpd", "drm.m3u8", "drm-video.m3u8"] as const;
export type DrmVariant = (typeof DRM_VARIANTS)[number];

export const DRM_CONTENT_TYPES: Record<DrmVariant, string> = {
  "drm.mp4": "video/mp4",
  "drm.mpd": "application/dash+xml",
  "drm.m3u8": "application/vnd.apple.mpegurl",
  "drm-video.m3u8": "application/vnd.apple.mpegurl",
};

const DRM_SUFFIX: Record<DrmVariant, string> = {
  "drm.mp4": ".mp4",
  "drm.mpd": ".mpd",
  "drm.m3u8": ".m3u8",
  "drm-video.m3u8": "-video.m3u8",
};

/** The folder of every DRM clip ever made for a photo: `{studio}/{job}/{photo}/drm/`. */
export function drmPrefix(parts: PhotoKeyParts): string {
  return `${photoPrefix(parts)}drm/`;
}

/**
 * Where one key's file is stored: `{studio}/{job}/{photo}/drm/{keyId}.mp4`, `.mpd`, `.m3u8`, `-video.m3u8` (review H1).
 * Each packaging run writes under its own key ID, so two runs for one photo (a repeated message, a stale request) never
 * overwrite each other: the files the database's key names are always the files that key encrypted. IDs only.
 */
export function drmObjectKey(parts: PhotoKeyParts, keyId: string, variant: DrmVariant): string {
  if (!isDrmKeyId(keyId)) throw new Error("drmObjectKey needs a key ID");
  return `${drmPrefix(parts)}${keyId}${DRM_SUFFIX[variant]}`;
}

/** Why packaging gave up for good (reported, logged; the cron doesn't retry these). */
export const DRM_FAILURE_REASONS = ["proof_missing", "too_large", "unreadable"] as const;
export type DrmFailureReason = (typeof DRM_FAILURE_REASONS)[number];

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/** A key ID: a random (v4) GUID, lower-case with dashes (B2: one key per photo). */
const KEY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isDrmKeyId(value: string): boolean {
  return KEY_ID.test(value);
}

/** A GUID's 16 bytes in the order it is written (big-endian), the way the key ID sits in the clip. */
export function guidBytes(guid: string): Uint8Array<ArrayBuffer> {
  const hex = guid.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("guidBytes needs a GUID");
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

/**
 * The clip's constant cbcs IV, as hex: the key ID's own 16 bytes (the spike's finding: Axinom's FairPlay server needs
 * the IV with every inline key, so it must be known, not random). Not secret: it is in the clip and the playlist.
 */
export function drmIvHex(keyId: string): string {
  if (!isDrmKeyId(keyId)) throw new Error("drmIvHex needs a key ID");
  return keyId.replaceAll("-", "");
}

// ── Tokens and manifests ──────────────────────────────────────────────────────────────────────────────────────────

/** A license token is good for this long after it is made… */
export const DRM_TOKEN_TTL_SECONDS = 60;
/** …and from this long before (a license server whose clock is a little behind still takes it). */
export const DRM_TOKEN_CLOCK_SKEW_SECONDS = 5;
/** The clip's file is signed for as long as the previews (ADR 0022). */
export const DRM_MANIFEST_SECONDS = 600;

/** C3: tokens per shop session, counted in the database. */
export const SHOP_DRM_TOKENS_PER_MINUTE = 60;
export const SHOP_DRM_TOKENS_PER_DAY = 1500;
/**
 * The DRM routes' own request budget per network (review: tester #4), separate from the shop's 120 a minute, so viewing
 * photos can never use up what the bag and checkout need. The per-session token limits above still apply.
 */
export const SHOP_DRM_REQUESTS_PER_MINUTE = 300;
export const SHOP_DRM_WIDE_REQUESTS_PER_MINUTE = 3000;

/** What the manifest route serves: the DASH manifest, the HLS master playlist, or the HLS media playlist. */
export const DRM_MANIFEST_FORMATS = ["dash", "hls", "hls-media"] as const;
export type DrmManifestFormat = (typeof DRM_MANIFEST_FORMATS)[number];

/** Which stored file each format reads. */
export const DRM_MANIFEST_VARIANT: Record<DrmManifestFormat, DrmVariant> = {
  dash: "drm.mpd",
  hls: "drm.m3u8",
  "hls-media": "drm-video.m3u8",
};

const xmlEscape = (text: string) =>
  text
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/** A stored manifest that isn't exactly what the packager writes, or isn't for the expected key. */
export class DrmManifestError extends Error {
  constructor() {
    super("drm_manifest_mismatch");
    this.name = "DrmManifestError";
  }
}

const fail = (): never => {
  throw new DrmManifestError();
};

/** The manifest's lines, without blank lines and the packager's "## Generated with …" comment. */
const playlistLines = (m3u8: string) =>
  m3u8.split(/\r?\n/).filter((line) => line.trim() !== "" && !line.startsWith("## "));

const safeAddress = (url: string) => (/[\s"<>]/.test(url) ? fail() : url);

/**
 * The DASH manifest with its one BaseURL (drm.mp4) replaced by the signed address, XML-escaped (& in the query).
 * Refused unless it has exactly one BaseURL and its cenc:default_KID is the expected key (review H1).
 */
export function rewriteDashManifest(mpd: string, signedClipUrl: string, keyId: string): string {
  const kids = [...mpd.matchAll(/cenc:default_KID="([^"]*)"/g)].map((m) => m[1]?.toLowerCase());
  if (kids.length !== 1 || kids[0] !== keyId) fail();
  const bases = mpd.match(/<BaseURL>[^<]*<\/BaseURL>/g) ?? [];
  if (bases.length !== 1 || bases[0] !== "<BaseURL>drm.mp4</BaseURL>") fail();
  return mpd.replace(
    "<BaseURL>drm.mp4</BaseURL>",
    `<BaseURL>${xmlEscape(safeAddress(signedClipUrl))}</BaseURL>`,
  );
}

/**
 * The HLS master playlist, exactly as the packager writes it (one variant: drm-video.m3u8), with that variant pointing
 * back at the manifest route. Anything else is refused.
 */
export function rewriteHlsMaster(m3u8: string, mediaPlaylistUrl: string): string {
  const lines = playlistLines(m3u8);
  if (
    lines.length !== 4 ||
    lines[0] !== "#EXTM3U" ||
    lines[1] !== "#EXT-X-INDEPENDENT-SEGMENTS" ||
    !/^#EXT-X-STREAM-INF:[^\n]*CODECS="avc1\.640028"/.test(lines[2] ?? "") ||
    lines[3] !== "drm-video.m3u8"
  )
    fail();
  return `${[lines[0], lines[1], lines[2], safeAddress(mediaPlaylistUrl)].join("\n")}\n`;
}

/**
 * The HLS media playlist, exactly as the packager writes it (one init map and one segment of drm.mp4, VOD, its keys),
 * with drm.mp4 replaced by the signed address. Every key line must be for the expected key: FairPlay's skd://<key ID>,
 * and KEYID=0x<key ID> where a line names one (review H1). Anything else is refused.
 */
export function rewriteHlsMedia(m3u8: string, signedClipUrl: string, keyId: string): string {
  const url = safeAddress(signedClipUrl);
  const hex = keyId.replaceAll("-", "");
  const lines = playlistLines(m3u8);
  const keys = lines.filter((l) => l.startsWith("#EXT-X-KEY:"));
  const rest = lines.filter((l) => !l.startsWith("#EXT-X-KEY:"));
  const shape = [
    /^#EXTM3U$/,
    /^#EXT-X-VERSION:\d+$/,
    /^#EXT-X-TARGETDURATION:\d+$/,
    /^#EXT-X-PLAYLIST-TYPE:VOD$/,
    /^#EXT-X-MAP:URI="drm\.mp4",BYTERANGE="\d+@\d+"$/,
    /^#EXTINF:[\d.]+,$/,
    /^#EXT-X-BYTERANGE:\d+@\d+$/,
    /^drm\.mp4$/,
    /^#EXT-X-ENDLIST$/,
  ];
  if (rest.length !== shape.length || !shape.every((re, i) => re.test(rest[i] ?? ""))) fail();
  if (
    keys.length === 0 ||
    !keys.includes(
      `#EXT-X-KEY:METHOD=SAMPLE-AES,URI="skd://${keyId}",KEYFORMATVERSIONS="1",KEYFORMAT="com.apple.streamingkeydelivery"`,
    )
  )
    fail();
  for (const key of keys) {
    if (!key.startsWith("#EXT-X-KEY:METHOD=SAMPLE-AES,")) fail();
    const named = /KEYID=0x([0-9a-fA-F]{32})/.exec(key)?.[1];
    if (named !== undefined && named.toLowerCase() !== hex) fail();
    const iv = /IV=0x([0-9a-fA-F]{32})/.exec(key)?.[1];
    if (iv !== undefined && iv.toLowerCase() !== hex) fail();
  }
  // Keys stay where the packager put them: before the segment, after the map.
  const out = lines.map((line) =>
    line.startsWith("#EXT-X-MAP:")
      ? line.replace('URI="drm.mp4"', `URI="${url}"`)
      : line === "drm.mp4"
        ? url
        : line,
  );
  return `${out.join("\n")}\n`;
}

// ── The viewer (C2, C7) ───────────────────────────────────────────────────────────────────────────────────────────

/**
 * A large view not shown within this long falls back to the watermarked WebP, silently. One budget per photo, from the
 * moment it is shown in the viewer, covering everything: the setup, the probe, loading Shaka, the manifest, the token,
 * the license and the first presented frame (review: tester #1).
 */
export const DRM_FALLBACK_TIMEOUT_MS = 8000;
/** After this many failures in a row, the rest of the tab's session uses the WebP. */
export const DRM_FAILURES_BEFORE_WEBP = 2;
/** "Loading photo" is said only after this long, so a quick photo never flashes it. */
export const DRM_LOADING_WORDS_AFTER_MS = 500;
/** While swiping, a photo must stay this long before its DRM clip is asked for (the first photo isn't held). */
export const DRM_SWIPE_SETTLE_MS = 300;

// ── Packaging runs (B6, C8) ───────────────────────────────────────────────────────────────────────────────────────

/** Photos the daily cron asks to be packaged, retries included. */
export const DRM_BACKFILL_PER_RUN = 2000;
/** A request with no answer after this long is queued again… */
export const DRM_RETRY_AFTER_MINUTES = 60;
/** …at most this many times in all, then the photo is failed (the shop keeps its WebP). */
export const DRM_MAX_REQUESTS = 3;
