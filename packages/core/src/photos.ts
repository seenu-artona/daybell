/**
 * Photo storage and upload (Phase 1 step 4; D39, D53, D60, D85, D100, F9, F10; ADR 0016). Pure rules shared by the
 * browser's uploader, the API, the storage drivers and the image worker: which files are uploaded, how a file is cut
 * into parts, where each object lives, the order photos are tagged in, and how the image worker's requests are signed.
 * Object keys and URLs hold IDs only, never a file's name (D96, D113).
 */

/** Seenu, answer 1: JPEG only, at most 50 MB a photo (50 MiB, so a camera's "50 MB" file always fits). */
export const MAX_PHOTO_BYTES = 52_428_800;
/** Seenu, answer 1: at most 50,000 photos per job, the bin included. */
export const MAX_PHOTOS_PER_JOB = 50_000;
/** Each part of a multipart upload. S3 needs at least 5 MiB for every part but the last; 50 MiB is 7 parts at most. */
export const PART_BYTES = 8 * 1024 * 1024;
/** Files registered per request. */
export const MAX_FILES_PER_REQUEST = 500;
/** Part URLs signed per request. */
export const MAX_PART_URLS_PER_REQUEST = 200;
/** Photos moved to or from the bin per request. */
export const MAX_PHOTOS_PER_BIN_REQUEST = 500;
/** Photos per page of a job's grid. */
export const PHOTO_PAGE_SIZE = 200;
/** Seenu, answer 7: binned photos are deleted for good after 30 days. */
export const BIN_DAYS = 30;
/** An upload that never finishes is dropped after 7 days (S3 aborts the parts after 7 days too). */
export const ABANDONED_UPLOAD_DAYS = 7;
/** A batch nobody finished (the tab was closed) is finished after a day without new files. */
export const IDLE_BATCH_HOURS = 24;

// ── Which files are uploaded ──────────────────────────────────────────────────────────────────────────────────────

export type SkipReason = "hidden" | "notJpeg" | "tooLarge" | "empty";

export interface CandidateFile {
  /** The file's name, or its path inside a dropped folder ("Day 1/IMG_0001.JPG"). */
  name: string;
  size: number;
}

const JPEG_NAME = /\.(jpe?g)$/i;

/**
 * Why a file is not uploaded, or null when it is. Hidden files and folders (".DS_Store", "._IMG_0001.JPG" made by
 * macOS on other disks, ".thumbnails/…") are skipped quietly; other files must be JPEG (Seenu, answer 1), not empty
 * and at most 50 MB. The server checks the bytes are really JPEG; this only spares uploading files that can't be.
 */
export function skipReason(file: CandidateFile): SkipReason | null {
  const segments = file.name.split(/[\\/]/).filter(Boolean);
  if (segments.some((s) => s.startsWith("."))) return "hidden";
  const base = segments.at(-1) ?? "";
  if (!JPEG_NAME.test(base)) return "notJpeg";
  if (file.size <= 0) return "empty";
  if (file.size > MAX_PHOTO_BYTES) return "tooLarge";
  return null;
}

/** Splits a drop into the files to upload and how many were skipped, by reason. Hidden files are not counted. */
export function filterUploadFiles<F extends CandidateFile>(
  files: readonly F[],
): { accepted: F[]; skipped: Record<Exclude<SkipReason, "hidden">, number> } {
  const accepted: F[] = [];
  const skipped = { notJpeg: 0, tooLarge: 0, empty: 0 };
  for (const file of files) {
    const reason = skipReason(file);
    if (reason === null) accepted.push(file);
    else if (reason !== "hidden") skipped[reason]++;
  }
  return { accepted, skipped };
}

/** The file's own name, without the folders it was dropped in; at most 255 characters (what the database keeps). */
export function baseName(name: string): string {
  const base = name.split(/[\\/]/).filter(Boolean).at(-1) ?? name;
  // Control characters never belong in a name; Array.from keeps surrogate pairs whole when cutting.
  // biome-ignore lint/suspicious/noControlCharactersInRegex: removing control characters is the point.
  return Array.from(base.replace(/[\u0000-\u001F\u007F]/g, ""))
    .slice(0, 255)
    .join("");
}

// ── Parts ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export interface PartPlan {
  partSize: number;
  partCount: number;
}

/** How a file of `size` bytes is cut into parts: every part PART_BYTES long except the last. */
export function planParts(size: number): PartPlan {
  if (!Number.isInteger(size) || size < 1 || size > MAX_PHOTO_BYTES)
    throw new Error("A photo is 1 byte to 50 MB");
  return { partSize: PART_BYTES, partCount: Math.ceil(size / PART_BYTES) };
}

/** The exact length of part `partNumber` (1-based), signed into its upload URL so storage refuses any other size. */
export function partLength(size: number, partNumber: number): number {
  const { partSize, partCount } = planParts(size);
  if (!Number.isInteger(partNumber) || partNumber < 1 || partNumber > partCount)
    throw new Error("No such part");
  return partNumber < partCount ? partSize : size - partSize * (partCount - 1);
}

/** The byte range of a part, for File.slice in the browser. */
export function partRange(size: number, partNumber: number): { start: number; end: number } {
  const start = (partNumber - 1) * PART_BYTES;
  return { start, end: start + partLength(size, partNumber) };
}

/**
 * Whether the uploaded parts make the whole file: every part from 1 to partCount, once, each its exact length. The
 * server checks this itself (it asks storage for the parts) before completing an upload, never trusting the browser.
 */
export function partsComplete(
  size: number,
  parts: readonly { partNumber: number; size: number }[],
): boolean {
  const { partCount } = planParts(size);
  if (parts.length !== partCount) return false;
  const seen = new Set<number>();
  for (const part of parts) {
    if (seen.has(part.partNumber)) return false;
    seen.add(part.partNumber);
    if (part.partNumber < 1 || part.partNumber > partCount) return false;
    if (part.size !== partLength(size, part.partNumber)) return false;
  }
  return true;
}

// ── Object keys ───────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What is stored for a photo. The original as uploaded; plain previews for the studio only; watermarked previews
 * (the studio's name tiled across) for parents (D60); and the file a parent downloads once they have paid
 * (`download.jpg`: full resolution, upright, sRGB, every bit of metadata stripped; ADR 0023, call 10). Previews and
 * the download are made once, at upload (D100). Parents never get the original.
 */
export const PHOTO_VARIANTS = [
  "original",
  "thumb.webp",
  "view.webp",
  "proof-thumb.webp",
  "proof.webp",
  "download.jpg",
] as const;
export type PhotoVariant = (typeof PHOTO_VARIANTS)[number];
/** The WebP previews (studio and parents). */
export type DerivativeVariant = Exclude<PhotoVariant, "original" | "download.jpg">;
/** The paid download's key's last part (ADR 0023). */
export const DOWNLOAD_VARIANT = "download.jpg" satisfies PhotoVariant;

/** Each preview's longest side in pixels and whether it carries the watermark. */
export const DERIVATIVES: Record<DerivativeVariant, { longestSide: number; watermark: boolean }> = {
  "thumb.webp": { longestSide: 400, watermark: false },
  "view.webp": { longestSide: 1600, watermark: false },
  "proof-thumb.webp": { longestSide: 400, watermark: true },
  "proof.webp": { longestSide: 1600, watermark: true },
};

const LOWER_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export interface PhotoKeyParts {
  studioId: string;
  jobId: string;
  photoId: string;
}

/** The folder of one photo's objects: `{studio}/{job}/{photo}/`. IDs only (lower-case UUIDs), never names. */
export function photoPrefix({ studioId, jobId, photoId }: PhotoKeyParts): string {
  for (const id of [studioId, jobId, photoId])
    if (!LOWER_UUID.test(id)) throw new Error("Photo keys hold lower-case UUIDs only");
  return `${studioId}/${jobId}/${photoId}/`;
}

/** One object's key, e.g. `{studio}/{job}/{photo}/original`. */
export function photoKey(parts: PhotoKeyParts, variant: PhotoVariant): string {
  return `${photoPrefix(parts)}${variant}`;
}

/** The IDs and variant in a key, or null if it isn't exactly a photo key (anything else is ignored by the worker). */
export function parsePhotoKey(key: string): (PhotoKeyParts & { variant: PhotoVariant }) | null {
  const parts = key.split("/");
  if (parts.length !== 4) return null;
  const [studioId, jobId, photoId, variant] = parts as [string, string, string, string];
  if (![studioId, jobId, photoId].every((id) => LOWER_UUID.test(id))) return null;
  if (!(PHOTO_VARIANTS as readonly string[]).includes(variant)) return null;
  return { studioId, jobId, photoId, variant: variant as PhotoVariant };
}

// ── Tagging order ─────────────────────────────────────────────────────────────────────────────────────────────────

export interface TaggingOrderFields {
  /** The upload batch's sequence number: earlier batches first (D142 answer 7). */
  batchSeq: number;
  /** EXIF capture time with sub-seconds, as "YYYY-MM-DDTHH:MM:SS.sss" (camera clock, no zone), or null. */
  capturedAt: string | null;
  originalFilename: string;
  id: string;
}

const utf8 = new TextEncoder();

/** Byte order of UTF-8, as Postgres compares text with COLLATE "C". */
export function compareUtf8(a: string, b: string): number {
  const x = utf8.encode(a);
  const y = utf8.encode(b);
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
  return x.length - y.length;
}

/**
 * The order photos are tagged in (Seenu, answer 2; D142 answers 5 and 7): by upload batch, then EXIF capture time,
 * then filename, then id. Photos without a capture time come after the timed photos of their batch, by filename. The
 * database's tagging-order index sorts the same way.
 */
export function compareTaggingOrder(a: TaggingOrderFields, b: TaggingOrderFields): number {
  if (a.batchSeq !== b.batchSeq) return a.batchSeq - b.batchSeq;
  if (a.capturedAt !== b.capturedAt) {
    if (a.capturedAt === null) return 1;
    if (b.capturedAt === null) return -1;
    return a.capturedAt < b.capturedAt ? -1 : 1;
  }
  return compareUtf8(a.originalFilename, b.originalFilename) || compareUtf8(a.id, b.id);
}

/**
 * EXIF DateTimeOriginal plus SubSecTimeOriginal as "YYYY-MM-DDTHH:MM:SS[.fff]", or null. The camera's clock has no
 * zone, so the time is kept as written. Sub-seconds keep burst shots in order; only digits are used, at most 6.
 */
export function exifCaptureTime(
  dateTimeOriginal: Date | null | undefined,
  subSec?: string | number | null,
): string | null {
  if (!(dateTimeOriginal instanceof Date) || Number.isNaN(dateTimeOriginal.getTime())) return null;
  const year = dateTimeOriginal.getUTCFullYear();
  if (year < 1900 || year > 9999) return null;
  const base = dateTimeOriginal.toISOString().slice(0, 19);
  const digits = String(subSec ?? "")
    .trim()
    .replace(/\D.*$/, "")
    .slice(0, 6);
  return digits ? `${base}.${digits}` : base;
}

// ── Signed requests between the image worker and the API ─────────────────────────────────────────────────────────

/** The header a signed worker request carries: `t=<unix seconds>,v1=<hex HMAC-SHA256>`. */
export const WORKER_SIGNATURE_HEADER = "Daybell-Signature";
/** The data region a worker request is for, signed with it, so a request can't be replayed against another region. */
export const WORKER_REGION_HEADER = "Daybell-Region";
/** How far apart the worker's and the API's clocks may be, in seconds. */
export const WORKER_CLOCK_SKEW_SECONDS = 300;
/** The shortest secret accepted. */
export const MIN_WORKER_SECRET_LENGTH = 32;

const hex = (bytes: ArrayBuffer | Uint8Array) =>
  Array.from(new Uint8Array(bytes), (b) => b.toString(16).padStart(2, "0")).join("");

function fromHex(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^(?:[0-9a-f]{2})+$/.test(text)) return null;
  const out = new Uint8Array(text.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = Number.parseInt(text.slice(i * 2, i * 2 + 2), 16);
  return out;
}

async function sha256Hex(body: Uint8Array<ArrayBuffer> | string): Promise<string> {
  const bytes = typeof body === "string" ? utf8.encode(body) : body;
  return hex(await crypto.subtle.digest("SHA-256", bytes));
}

function hmacKey(secret: string, usage: "sign" | "verify"): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    utf8.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    [usage],
  );
}

export interface WorkerRequest {
  method: string;
  /** The URL's path, e.g. /api/v1/internal/photo-worker/photos/{id}/result. */
  path: string;
  region: string;
  body: Uint8Array<ArrayBuffer> | string;
}

/** What is signed: time, region, method, path and the body's SHA-256, joined by dots. */
async function signedText(t: number, req: WorkerRequest): Promise<string> {
  return `${t}.${req.region}.${req.method.toUpperCase()}.${req.path}.${await sha256Hex(req.body)}`;
}

/** The Daybell-Signature header for a request from the image worker. */
export async function signWorkerRequest(
  secret: string,
  req: WorkerRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<string> {
  if (secret.length < MIN_WORKER_SECRET_LENGTH) throw new Error("The worker secret is too short");
  const key = await hmacKey(secret, "sign");
  const mac = await crypto.subtle.sign("HMAC", key, utf8.encode(await signedText(nowSeconds, req)));
  return `t=${nowSeconds},v1=${hex(mac)}`;
}

/**
 * Whether a worker request is genuine: signed with any of `secrets` (two during a rotation), within the allowed clock
 * skew. The MAC is checked with WebCrypto's verify, which compares in constant time.
 */
export async function verifyWorkerRequest(
  secrets: readonly string[],
  header: string | null,
  req: WorkerRequest,
  nowSeconds = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const match = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/.exec(header?.trim() ?? "");
  if (!match) return false;
  const t = Number(match[1]);
  if (Math.abs(nowSeconds - t) > WORKER_CLOCK_SKEW_SECONDS) return false;
  const mac = fromHex(match[2] as string);
  if (!mac) return false;
  const text = utf8.encode(await signedText(t, req));
  for (const secret of secrets) {
    if (secret.length < MIN_WORKER_SECRET_LENGTH) continue;
    if (await crypto.subtle.verify("HMAC", await hmacKey(secret, "verify"), mac, text)) return true;
  }
  return false;
}

/** SHA-256 of bytes as lower-case hex: the browser hashes each file with it, and the worker checks the upload. */
export async function sha256OfBytes(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  return sha256Hex(bytes);
}
