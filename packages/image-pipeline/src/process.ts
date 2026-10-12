import { fileURLToPath } from "node:url";
import {
  DERIVATIVES,
  type DerivativeVariant,
  exifCaptureTime,
  MAX_PHOTO_BYTES,
  sha256OfBytes,
} from "@daybell/core";
import exif from "exif-reader";
import sharp, { type Metadata, type Sharp } from "sharp";

/**
 * Makes a photo's previews once, at upload (D60, D100; ADR 0016). Pure: bytes in, previews and facts out; the image
 * worker (Lambda, in the studio's region) and the local driver both call it. Never logs: the caller logs the photo's
 * id and a reason only.
 */

/** Why a photo can't be used. Stored on the photo; never more detail (no names, no file contents). */
export type FailureReason = "not_jpeg" | "too_large" | "hash_mismatch" | "unreadable";

export interface PhotoFacts {
  /** After turning the photo upright (EXIF orientation). */
  width: number;
  height: number;
  /** EXIF capture time with sub-seconds, "YYYY-MM-DDTHH:MM:SS[.fff]", or null. */
  capturedAt: string | null;
}

export type ProcessResult =
  | { ok: true; facts: PhotoFacts; derivatives: Record<DerivativeVariant, Buffer> }
  | { ok: false; reason: FailureReason };

export const DERIVATIVE_CONTENT_TYPE = "image/webp";
/** WebP quality: small enough for a grid of 200, sharp enough to judge focus at 1600 px. */
const WEBP_QUALITY = 80;
/** About 30% opacity (Seenu, answer 4). */
export const WATERMARK_OPACITY = 0.3;
/** Diagonal, rising to the right. */
const WATERMARK_ANGLE = -30;

/**
 * The bundled watermark font, next to this package (and next to the Lambda's bundle, at ../assets). Resolved when
 * first needed, so bundlers that move this file can pass their own path instead (`fontFile`).
 */
export function defaultFontFile(): string {
  return fileURLToPath(new URL("../assets/PlusJakartaSans-Bold.ttf", import.meta.url));
}

/** Pango markup needs &, < and > escaped; quotes too inside attributes. Control characters are dropped. */
export function escapePango(text: string): string {
  return (
    text
      // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
      .replace(/[\u0000-\u001F\u007F]/g, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&apos;")
  );
}

const isJpeg = (bytes: Uint8Array) => bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;

/**
 * One tile of the watermark for a preview whose longest side is `longestSide`: the studio's name in white with a soft
 * dark shadow (readable on light and dark photos), at about 30% opacity, turned 30°, with room around it so the tiles
 * don't touch. The fonts file is bundled; no system font is used.
 */
export async function watermarkTile(
  studioName: string,
  longestSide: number,
  fontFile: string = defaultFontFile(),
): Promise<Buffer> {
  const size = Math.max(12, Math.round(longestSide * 0.04));
  const text = escapePango(studioName.trim()) || "&#8203;";
  const render = (colour: string) =>
    sharp({
      text: {
        text: `<span foreground="${colour}">${text}</span>`,
        font: `Plus Jakarta Sans Bold ${size}`,
        fontfile: fontFile,
        rgba: true,
        dpi: 72,
        width: Math.round(longestSide * 0.45),
        wrap: "word",
      },
    })
      .png()
      .toBuffer({ resolveWithObject: true });
  const [white, black] = await Promise.all([render("white"), render("black")]);
  const pad = Math.round(size * 0.6);
  const shadowOffset = Math.max(1, Math.round(size / 24));
  const shadow = await sharp(black.data)
    .blur(Math.max(0.6, size / 20))
    .png()
    .toBuffer();
  const layered = await sharp({
    create: {
      width: white.info.width + pad * 2,
      height: white.info.height + pad * 2,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([
      { input: shadow, left: pad + shadowOffset, top: pad + shadowOffset },
      { input: white.data, left: pad, top: pad },
    ])
    .png()
    .toBuffer();
  return sharp(layered)
    .rotate(WATERMARK_ANGLE, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .linear([1, 1, 1, WATERMARK_OPACITY], [0, 0, 0, 0])
    .png()
    .toBuffer();
}

function readFacts(meta: Metadata): PhotoFacts {
  const upright = (meta.orientation ?? 1) >= 5;
  const width = (upright ? meta.height : meta.width) ?? 0;
  const height = (upright ? meta.width : meta.height) ?? 0;
  let capturedAt: string | null = null;
  if (meta.exif) {
    try {
      const tags = exif(meta.exif);
      capturedAt = exifCaptureTime(tags.Photo?.DateTimeOriginal, tags.Photo?.SubSecTimeOriginal);
    } catch {
      // Broken EXIF: the photo is still fine, just untimed (it sorts after timed photos).
      capturedAt = null;
    }
  }
  return { width, height, capturedAt };
}

/**
 * Decompression bombs: a small file can claim a huge image. Originals of more than 120 million pixels are refused
 * (a 100 MP camera is about 100 million), and progressive JPEGs, which must be decoded whole, at half that. The
 * limits are checked from the header before any pixel is decoded, and libvips enforces them again while decoding.
 */
export const MAX_INPUT_PIXELS = 120_000_000;
export const MAX_PROGRESSIVE_PIXELS = 60_000_000;

const decoder = (input: Buffer, limit: number) =>
  sharp(input, { failOn: "error", limitInputPixels: limit, sequentialRead: true });

/** Fits a watermark tile inside a preview of `w` × `h` (very wide or tiny photos). */
async function tileFor(
  cache: Map<number, Buffer>,
  studioName: string,
  w: number,
  h: number,
  fontFile: string | undefined,
): Promise<Buffer> {
  const side = Math.max(w, h);
  let tile = cache.get(side) ?? (await watermarkTile(studioName, side, fontFile));
  cache.set(side, tile);
  const t = await sharp(tile).metadata();
  if ((t.width ?? 0) > w || (t.height ?? 0) > h)
    tile = await sharp(tile).resize({ width: w, height: h, fit: "inside" }).png().toBuffer();
  return tile;
}

/**
 * Checks an uploaded original and makes its four previews: 400 px and 1600 px plain (the studio's screens) and the
 * same sizes watermarked with the studio's name (parents, later). The original must be the file the browser hashed
 * (SHA-256), JPEG (Seenu, answer 1), at most 50 MB and at most MAX_INPUT_PIXELS. It is decoded once, to the 1600 px
 * size; the other previews are made from that. Previews are upright (EXIF orientation applied), sRGB WebP, with every
 * bit of metadata stripped: no EXIF, XMP, IPTC, GPS or camera serial.
 */
export async function processOriginal(
  bytes: Uint8Array<ArrayBuffer>,
  options: {
    studioName: string;
    expectedSha256: string;
    fontFile?: string;
    /** Tests only: lower pixel limits. */
    maxPixels?: number;
    maxProgressivePixels?: number;
  },
): Promise<ProcessResult> {
  if (bytes.length > MAX_PHOTO_BYTES) return { ok: false, reason: "too_large" };
  if ((await sha256OfBytes(bytes)) !== options.expectedSha256.toLowerCase())
    return { ok: false, reason: "hash_mismatch" };
  if (!isJpeg(bytes)) return { ok: false, reason: "not_jpeg" };

  const maxPixels = options.maxPixels ?? MAX_INPUT_PIXELS;
  const maxProgressive = options.maxProgressivePixels ?? MAX_PROGRESSIVE_PIXELS;
  const input = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let facts: PhotoFacts;
  let limit: number;
  try {
    // The header only: no pixels are decoded here, so the size is read without a limit and checked below.
    const meta = await sharp(input, { failOn: "error", limitInputPixels: false }).metadata();
    if (meta.format !== "jpeg") return { ok: false, reason: "not_jpeg" };
    limit = meta.isProgressive ? maxProgressive : maxPixels;
    if ((meta.width ?? 0) * (meta.height ?? 0) > limit) return { ok: false, reason: "too_large" };
    facts = readFacts(meta);
  } catch {
    return { ok: false, reason: "unreadable" };
  }

  try {
    const view = DERIVATIVES["view.webp"].longestSide;
    const thumb = DERIVATIVES["thumb.webp"].longestSide;
    // Decoded once (JPEG shrink-on-load does most of the work), upright, sRGB, to the largest preview's size.
    const { data, info } = await decoder(input, limit)
      .autoOrient()
      .resize({ width: view, height: view, fit: "inside", withoutEnlargement: true })
      .toColourspace("srgb")
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const raw = { raw: { width: info.width, height: info.height, channels: info.channels } };
    const scale = Math.min(1, thumb / Math.max(info.width, info.height));
    const small = {
      width: Math.max(1, Math.round(info.width * scale)),
      height: Math.max(1, Math.round(info.height * scale)),
    };
    const tiles = new Map<number, Buffer>();
    const webp = (image: Sharp) => image.webp({ quality: WEBP_QUALITY }).toBuffer();
    const [viewBuf, thumbBuf, proofBuf, proofThumbBuf] = await Promise.all([
      webp(sharp(data, raw)),
      webp(sharp(data, raw).resize(small)),
      tileFor(tiles, options.studioName, info.width, info.height, options.fontFile).then((tile) =>
        webp(sharp(data, raw).composite([{ input: tile, tile: true, blend: "over" }])),
      ),
      tileFor(tiles, options.studioName, small.width, small.height, options.fontFile).then(
        async (tile) =>
          webp(
            sharp(await sharp(data, raw).resize(small).raw().toBuffer(), {
              raw: { ...small, channels: info.channels },
            }).composite([{ input: tile, tile: true, blend: "over" }]),
          ),
      ),
    ]);
    const derivatives: Record<DerivativeVariant, Buffer> = {
      "view.webp": viewBuf,
      "thumb.webp": thumbBuf,
      "proof.webp": proofBuf,
      "proof-thumb.webp": proofThumbBuf,
    };
    return { ok: true, facts, derivatives };
  } catch {
    return { ok: false, reason: "unreadable" };
  }
}
