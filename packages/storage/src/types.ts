import type { Readable } from "node:stream";

/**
 * Photo storage behind one interface (D53; ADR 0016). S3 in ca-central-1 for Canadian studios now; Cloudflare R2 (also
 * S3-compatible) for US studios later; a local folder for development, CI and end-to-end tests. Keys hold IDs only
 * (see photoKey in @daybell/core); callers never pass names.
 */
export interface UploadedPart {
  partNumber: number;
  size: number;
  etag: string;
}

export interface StoredObject {
  size: number;
}

export interface PutOptions {
  contentType: string;
  /** e.g. "private, max-age=3600" for previews. */
  cacheControl?: string;
}

export interface PhotoStorage {
  /** Starts a multipart upload of an original; returns the upload's id. */
  createMultipart(key: string, contentType: string): Promise<string>;
  /**
   * A URL the browser PUTs one part to. The part's exact length is signed in, so storage refuses any other size.
   * Valid for `expiresIn` seconds.
   */
  presignPart(
    key: string,
    uploadId: string,
    partNumber: number,
    contentLength: number,
    expiresIn: number,
  ): Promise<string>;
  /**
   * The parts storage has received, in part order. The server completes an upload from these, never from the
   * browser. An upload already completed or aborted throws StorageError("not_found"), as `complete` does.
   */
  listParts(key: string, uploadId: string): Promise<UploadedPart[]>;
  complete(key: string, uploadId: string, parts: readonly UploadedPart[]): Promise<void>;
  /** Drops an unfinished upload and its parts. Missing uploads are not an error. */
  abort(key: string, uploadId: string): Promise<void>;
  /** The object's size, or null if it doesn't exist (S3: by listing, so originals needn't be readable). */
  head(key: string): Promise<StoredObject | null>;
  get(key: string): Promise<Uint8Array<ArrayBuffer>>;
  /**
   * The object as a stream, read as it is sent on (an order's zip, ADR 0024): never all in memory. A missing object
   * throws StorageError("not_found").
   */
  getStream(key: string): Promise<Readable>;
  put(key: string, body: Uint8Array, options: PutOptions): Promise<void>;
  /**
   * A short-lived URL to read an object (previews for the studio's screens), valid for `expiresIn` seconds at most and
   * never longer than the credentials that sign it. `signedAt` is for tests. With `download`, the browser saves the
   * object as that file name (Content-Disposition: attachment) as a JPEG (a parent's paid download, ADR 0023); the name
   * is signed into the URL and holds only letters, digits, dots, dashes and underscores.
   */
  presignGet(
    key: string,
    options: { expiresIn: number; signedAt?: Date; download?: { filename: string } },
  ): Promise<string>;
  /** Deletes every object and every version under a prefix (`{studio}/{job}/{photo}/`). Returns how many. */
  deleteAllVersions(prefix: string): Promise<number>;
}

/** A download's file name: plain characters only, so it can never break the header it is put in. */
export const DOWNLOAD_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

/** The Content-Disposition a download is served with. */
export function attachmentDisposition(filename: string): string {
  if (!DOWNLOAD_FILENAME.test(filename)) throw new StorageError("invalid_key");
  return `attachment; filename="${filename}"`;
}

/** The driver refused: a bad key, or storage that isn't there. Never carries a key's or file's content. */
export class StorageError extends Error {
  constructor(readonly code: "invalid_key" | "not_found" | "invalid_signature" | "unavailable") {
    super(code);
    this.name = "StorageError";
  }
}
