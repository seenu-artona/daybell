import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { attachmentDisposition, type PhotoStorage, StorageError, type UploadedPart } from "./types";

/**
 * The local driver: a folder on disk, for development, CI and end-to-end tests (STORAGE_DRIVER=local; refused in
 * production by @daybell/config). It behaves like S3 where the app depends on it: multipart uploads with parts PUT
 * straight from the browser to signed, expiring URLs whose length is fixed, and signed URLs to read previews. The
 * URLs point at the web app's dev-storage route, which exists only with this driver.
 */
export interface LocalPhotoStorage extends PhotoStorage {
  /** Stores a PUT part after checking its signed URL and exact length. */
  receivePart(key: string, query: URLSearchParams, body: Uint8Array): Promise<string>;
  /** Reads an object for a signed GET URL. */
  readSigned(key: string, query: URLSearchParams): Promise<Uint8Array<ArrayBuffer>>;
  /** The Content-Disposition a signed GET URL asked for (a download, ADR 0023), or null. Call after readSigned. */
  signedDisposition(query: URLSearchParams): string | null;
}

const SAFE_KEY = /^[0-9a-z][0-9a-z./-]*$/;
const UPLOAD_ID = /^[0-9a-f]{32}$/;
const UPLOADS = ".uploads";

export function localPhotoStorage({
  root,
  secret,
  baseUrl = "/api/dev-storage",
  now = () => Date.now(),
}: {
  root: string;
  /** Signs the URLs. A random per-process secret is enough: the same process signs and checks them. */
  secret: Uint8Array;
  baseUrl?: string;
  now?: () => number;
}): LocalPhotoStorage {
  const base = resolve(root);

  function pathOf(key: string): string {
    if (!SAFE_KEY.test(key) || key.includes("..") || key.startsWith(UPLOADS))
      throw new StorageError("invalid_key");
    const full = resolve(base, key);
    if (!full.startsWith(base + sep)) throw new StorageError("invalid_key");
    return full;
  }

  function uploadDir(uploadId: string): string {
    if (!UPLOAD_ID.test(uploadId)) throw new StorageError("not_found");
    return join(base, UPLOADS, uploadId);
  }

  const sign = (text: string) => createHmac("sha256", secret).update(text).digest("hex");

  function checkSignature(text: string, query: URLSearchParams): void {
    const expires = Number(query.get("expires"));
    const given = Buffer.from(query.get("sig") ?? "", "hex");
    const wanted = Buffer.from(sign(`${text}\n${expires}`), "hex");
    if (!Number.isFinite(expires) || expires * 1000 < now())
      throw new StorageError("invalid_signature");
    if (given.length !== wanted.length || !timingSafeEqual(given, wanted))
      throw new StorageError("invalid_signature");
  }

  function signedUrl(
    key: string,
    text: string,
    params: Record<string, string>,
    expiresIn: number,
    at?: Date,
  ) {
    const expires = Math.floor((at?.getTime() ?? now()) / 1000) + expiresIn;
    const query = new URLSearchParams({
      ...params,
      expires: String(expires),
      sig: sign(`${text}\n${expires}`),
    });
    return `${baseUrl}/${key}?${query}`;
  }

  async function uploadKey(uploadId: string): Promise<string> {
    try {
      return JSON.parse(await readFile(join(uploadDir(uploadId), "upload.json"), "utf8")).key;
    } catch {
      throw new StorageError("not_found");
    }
  }

  async function parts(uploadId: string): Promise<UploadedPart[]> {
    const dir = join(uploadDir(uploadId), "parts");
    const names = await readdir(dir).catch(() => [] as string[]);
    const out: UploadedPart[] = [];
    for (const name of names) {
      if (!/^\d+$/.test(name)) continue;
      const bytes = await readFile(join(dir, name));
      out.push({
        partNumber: Number(name),
        size: bytes.length,
        etag: `"${createHash("md5").update(bytes).digest("hex")}"`,
      });
    }
    return out.sort((a, b) => a.partNumber - b.partNumber);
  }

  return {
    async createMultipart(key) {
      pathOf(key);
      const uploadId = randomBytes(16).toString("hex");
      await mkdir(join(uploadDir(uploadId), "parts"), { recursive: true });
      await writeFile(join(uploadDir(uploadId), "upload.json"), JSON.stringify({ key }));
      return uploadId;
    },

    async presignPart(key, uploadId, partNumber, contentLength, expiresIn) {
      pathOf(key);
      return signedUrl(
        key,
        `PUT\n${key}\n${uploadId}\n${partNumber}\n${contentLength}`,
        { uploadId, partNumber: String(partNumber), length: String(contentLength) },
        expiresIn,
      );
    },

    async receivePart(key, query, body) {
      pathOf(key);
      const uploadId = query.get("uploadId") ?? "";
      const partNumber = Number(query.get("partNumber"));
      const length = Number(query.get("length"));
      checkSignature(`PUT\n${key}\n${uploadId}\n${partNumber}\n${length}`, query);
      if (body.length !== length) throw new StorageError("invalid_signature");
      if ((await uploadKey(uploadId)) !== key) throw new StorageError("not_found");
      await writeFile(join(uploadDir(uploadId), "parts", String(partNumber)), body);
      return `"${createHash("md5").update(body).digest("hex")}"`;
    },

    async listParts(key, uploadId) {
      if ((await uploadKey(uploadId)) !== key) throw new StorageError("not_found");
      return parts(uploadId);
    },

    async complete(key, uploadId, wanted) {
      if ((await uploadKey(uploadId)) !== key) throw new StorageError("not_found");
      const have = new Map((await parts(uploadId)).map((p) => [p.partNumber, p]));
      const chunks: Buffer[] = [];
      for (const part of [...wanted].sort((a, b) => a.partNumber - b.partNumber)) {
        if (have.get(part.partNumber)?.etag !== part.etag)
          throw new StorageError("invalid_signature");
        chunks.push(await readFile(join(uploadDir(uploadId), "parts", String(part.partNumber))));
      }
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, Buffer.concat(chunks));
      await rm(uploadDir(uploadId), { recursive: true, force: true });
    },

    async abort(_key, uploadId) {
      if (!UPLOAD_ID.test(uploadId)) return;
      await rm(uploadDir(uploadId), { recursive: true, force: true });
    },

    async head(key) {
      try {
        return { size: (await stat(pathOf(key))).size };
      } catch (err) {
        if (err instanceof StorageError) throw err;
        return null;
      }
    },

    async get(key) {
      try {
        return new Uint8Array(await readFile(pathOf(key)));
      } catch (err) {
        if (err instanceof StorageError) throw err;
        throw new StorageError("not_found");
      }
    },

    async getStream(key) {
      const path = pathOf(key);
      try {
        await stat(path);
      } catch {
        throw new StorageError("not_found");
      }
      return createReadStream(path);
    },

    async put(key, body) {
      const target = pathOf(key);
      await mkdir(dirname(target), { recursive: true });
      await writeFile(target, body);
    },

    async presignGet(key, { expiresIn, signedAt, download }) {
      pathOf(key);
      if (!download) return signedUrl(key, `GET\n${key}`, {}, expiresIn, signedAt);
      attachmentDisposition(download.filename);
      return signedUrl(
        key,
        `GET\n${key}\n${download.filename}`,
        { download: download.filename },
        expiresIn,
        signedAt,
      );
    },

    async readSigned(key, query) {
      const download = query.get("download");
      checkSignature(download === null ? `GET\n${key}` : `GET\n${key}\n${download}`, query);
      return this.get(key);
    },

    signedDisposition(query) {
      const download = query.get("download");
      return download === null ? null : attachmentDisposition(download);
    },

    async deleteAllVersions(prefix) {
      if (!prefix.endsWith("/")) throw new StorageError("invalid_key");
      const dir = pathOf(prefix.slice(0, -1));
      const names = await readdir(dir).catch(() => [] as string[]);
      await rm(dir, { recursive: true, force: true });
      return names.length;
    },
  };
}
