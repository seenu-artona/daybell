import type {
  PartUrlsResponse,
  RegisterFilesResponse,
  UploadBatchResponse,
  UploadCompleteResponse,
  UploadPartsResponse,
} from "@daybell/api";
import { baseName, filterUploadFiles, MAX_FILES_PER_REQUEST, partRange } from "@daybell/core";
import type { ApiResult } from "@/lib/client-api";

/**
 * One drop of photos, uploaded from this browser straight to storage (D39; ADR 0016): files are filtered (JPEG only,
 * up to 50 MB), hashed, registered with the API in chunks of 500 (duplicates in the job are skipped), then cut into
 * parts and sent six at a time to signed URLs. A dropped connection waits and retries with growing pauses, and pauses
 * while the browser is offline. Resuming is driven by the server: dropping the same files again (after a reload, or on
 * another computer) finds the photos still uploading and sends only their missing parts. Nothing about the upload is
 * stored in the browser, and filenames go to the API in request bodies only.
 */

export type UploadPhase = "checking" | "uploading" | "offline" | "finishing" | "done" | "stopped";

export interface UploadProgress {
  phase: UploadPhase;
  /** JPEGs in the drop. */
  total: number;
  /** Hashed so far. */
  checked: number;
  /** Uploaded whole (now processing). */
  uploaded: number;
  /** Couldn't be uploaded (after retries) or arrived damaged. */
  failed: number;
  /** Already in the job (or twice in the drop). */
  duplicates: number;
  /** Left out by the browser: not JPEG, empty or over 50 MB. */
  skipped: number;
  /** Why the upload stopped: a PHOTO_CONFLICTS key (e.g. photos.jobClosed) or an API error code. */
  problem: string | null;
}

/** A file to upload: the File and the name to register (its own name, without folders). */
export interface DropFile {
  file: File;
  /** The path inside the dropped folder, for filtering hidden files; never sent. */
  path: string;
}

type Api = <T>(path: string, init?: { method?: string; body?: unknown }) => Promise<ApiResult<T>>;

export interface UploadDeps {
  api: Api;
  /** PUTs a part to a signed URL; resolves with the HTTP status, or 0 when the network failed. */
  put: (url: string, body: Blob) => Promise<number>;
  hash: (file: File) => Promise<string | null>;
  /** Resolves when the browser is online (immediately if it is). */
  online: () => Promise<void>;
  sleep: (ms: number) => Promise<void>;
}

/** Parts in flight at once. S3 speaks HTTP/1.1, where browsers open six connections per host. */
export const PARTS_IN_FLIGHT = 6;
/** Files hashed at once. */
export const HASHING_IN_PARALLEL = 3;
/** Tries per request before a file is counted as failed. */
const TRIES = 8;

/** Growing pauses between tries: 1 s, 2 s, 4 s … up to 30 s. */
export function retryDelay(attempt: number): number {
  return Math.min(30_000, 1000 * 2 ** Math.max(0, attempt - 1));
}

const retryable = (status: number) => status === 0 || status === 429 || status >= 500;

interface Item {
  drop: DropFile;
  file: File;
  name: string;
  size: number;
  sha256: string;
  photoId: string;
  partCount: number;
  missing: number[];
}

export class UploadRun {
  readonly progress: UploadProgress;
  private batchId: string | null = null;
  private stopped = false;
  /** Files that were twice in the drop: sent once, and counted on the batch as duplicates (review CR10). */
  private dropDuplicates = 0;
  /** Registered photos, and those uploaded whole (the rest are cancelled by Stop). */
  private readonly registered: Item[] = [];
  private readonly uploadedItems = new Set<Item>();
  private running: Promise<void> | null = null;

  constructor(
    private readonly jobId: string,
    files: readonly DropFile[],
    private readonly deps: UploadDeps,
    private readonly onProgress: (progress: UploadProgress) => void,
  ) {
    const { accepted, skipped } = filterUploadFiles(
      files.map((f) => ({ name: f.path, size: f.file.size, drop: f })),
    );
    this.accepted = accepted.map((a) => a.drop);
    this.progress = {
      phase: "checking",
      total: this.accepted.length,
      checked: 0,
      uploaded: 0,
      failed: 0,
      duplicates: 0,
      skipped: skipped.notJpeg + skipped.tooLarge + skipped.empty,
      problem: null,
    };
  }

  private readonly accepted: DropFile[];
  private readonly failedFiles = new Set<DropFile>();

  /** The files that couldn't be uploaded, to try again (the server resumes whatever did arrive). */
  failed(): DropFile[] {
    return [...this.failedFiles];
  }

  private emit(change: Partial<UploadProgress> = {}) {
    Object.assign(this.progress, change);
    this.onProgress({ ...this.progress });
  }

  /**
   * Stop: no new part is sent, the parts in flight finish, the batch is finished, and the photos that hadn't finished
   * uploading are cancelled (their parts dropped), so nothing half-sent is left in the job.
   */
  async cancel(): Promise<void> {
    this.stopped = true;
    await this.running;
    for (const item of this.registered)
      if (!this.uploadedItems.has(item))
        await this.deps.api(`/photos/${encodeURIComponent(item.photoId)}/upload`, {
          method: "DELETE",
        });
    this.emit({ phase: "stopped", problem: null });
  }

  /** Calls the API, trying again on network and server errors (waiting while offline). */
  private async call<T>(
    path: string,
    init?: { method?: string; body?: unknown },
  ): Promise<ApiResult<T>> {
    for (let attempt = 1; ; attempt++) {
      await this.waitOnline();
      const res = await this.deps.api<T>(path, init);
      if (res.ok || !retryable(res.status) || attempt >= TRIES || this.stopped) return res;
      await this.deps.sleep(retryDelay(attempt));
    }
  }

  private async waitOnline() {
    const before = this.progress.phase;
    let waited = false;
    const wait = this.deps.online().then(() => {
      waited = true;
    });
    // Only show "offline" when it actually has to wait.
    await Promise.race([wait, this.deps.sleep(0)]);
    if (!waited) {
      this.emit({ phase: "offline" });
      await wait;
      this.emit({ phase: before === "offline" ? "uploading" : before });
    }
  }

  private fail(problem: string) {
    this.emit({ phase: "stopped", problem });
  }

  start(): Promise<void> {
    this.running ??= this.run();
    return this.running;
  }

  private async run(): Promise<void> {
    if (this.accepted.length === 0) {
      this.emit({ phase: "done" });
      return;
    }
    const batch = await this.call<UploadBatchResponse>(
      `/jobs/${encodeURIComponent(this.jobId)}/upload-batches`,
      { method: "POST" },
    );
    if (!batch.ok) return this.fail(batch.fields.form ?? batch.code);
    this.batchId = batch.data.batchId;

    const hashed = await this.hashAll();
    if (this.stopped) {
      await this.finish();
      return;
    }
    // Files registered before a later chunk was refused are still uploaded, then the upload stops and says why.
    const { items, problem } = await this.registerAll(hashed);
    this.emit({ phase: "uploading" });
    await this.uploadAll(items);
    await this.finish();
    if (problem) this.fail(problem);
  }

  private async hashAll(): Promise<{ drop: DropFile; sha256: string }[]> {
    const out: ({ drop: DropFile; sha256: string } | null)[] = new Array(this.accepted.length).fill(
      null,
    );
    let next = 0;
    const work = async () => {
      while (next < this.accepted.length && !this.stopped) {
        const i = next++;
        const drop = this.accepted[i] as DropFile;
        const sha256 = await this.deps.hash(drop.file);
        if (sha256) out[i] = { drop, sha256 };
        else {
          this.failedFiles.add(drop);
          this.progress.failed++;
        }
        this.emit({ checked: this.progress.checked + 1 });
      }
    };
    await Promise.all(Array.from({ length: HASHING_IN_PARALLEL }, work));
    // The same file twice in the drop is uploaded once and counted as a duplicate.
    const seen = new Set<string>();
    return out.filter((h): h is { drop: DropFile; sha256: string } => {
      if (!h) return false;
      if (seen.has(h.sha256)) {
        this.progress.duplicates++;
        this.dropDuplicates++;
        return false;
      }
      seen.add(h.sha256);
      return true;
    });
  }

  private async registerAll(
    hashed: { drop: DropFile; sha256: string }[],
  ): Promise<{ items: Item[]; problem: string | null }> {
    const items: Item[] = [];
    for (let i = 0; i < hashed.length && !this.stopped; i += MAX_FILES_PER_REQUEST) {
      const chunk = hashed.slice(i, i + MAX_FILES_PER_REQUEST);
      const res = await this.call<RegisterFilesResponse>(`/upload-batches/${this.batchId}/files`, {
        method: "POST",
        body: {
          files: chunk.map((h) => ({
            name: baseName(h.drop.path),
            size: h.drop.file.size,
            sha256: h.sha256,
          })),
        },
      });
      if (!res.ok) return { items, problem: res.fields.form ?? res.code };
      const resumed: Item[] = [];
      for (const r of res.data.results) {
        const h = chunk[r.index];
        if (!h) continue;
        if (r.outcome === "duplicate" || r.outcome === "duplicate_in_bin" || !r.photoId) {
          this.progress.duplicates++;
          continue;
        }
        const all = Array.from({ length: r.partCount }, (_, n) => n + 1);
        const item: Item = {
          drop: h.drop,
          file: h.drop.file,
          name: baseName(h.drop.path),
          size: h.drop.file.size,
          sha256: h.sha256,
          photoId: r.photoId,
          partCount: r.partCount,
          missing: all,
        };
        if (r.outcome === "resume") resumed.push(item);
        items.push(item);
        this.registered.push(item);
      }
      // Resumed files send only the parts storage doesn't have yet; asked a few at a time (review CR11).
      let next = 0;
      const ask = async () => {
        while (next < resumed.length) {
          const item = resumed[next++] as Item;
          const parts = await this.call<UploadPartsResponse>(
            `/photos/${item.photoId}/upload-parts`,
          );
          if (parts.ok) item.missing = item.missing.filter((n) => !parts.data.parts.includes(n));
        }
      };
      await Promise.all(Array.from({ length: PARTS_IN_FLIGHT }, ask));
      this.emit();
    }
    return { items, problem: null };
  }

  private async uploadAll(items: Item[]): Promise<void> {
    // One queue of parts across files, in drop order; PARTS_IN_FLIGHT workers take the next part.
    const queue = items.flatMap((item) => item.missing.map((partNumber) => ({ item, partNumber })));
    const remaining = new Map(items.map((item) => [item, item.missing.length]));
    const urls = new Map<Item, Promise<Map<number, string> | null>>();
    const broken = new Set<Item>();

    const urlsFor = (item: Item, refresh = false) => {
      if (refresh || !urls.has(item)) urls.set(item, this.partUrls(item));
      return urls.get(item) as Promise<Map<number, string> | null>;
    };

    // Files whose parts are all there already (a resume that only needed completing).
    for (const item of items) if (item.missing.length === 0) await this.complete(item);

    let next = 0;
    const work = async () => {
      while (next < queue.length && !this.stopped) {
        const { item, partNumber } = queue[next++] as { item: Item; partNumber: number };
        if (broken.has(item)) continue;
        const ok = await this.sendPart(item, partNumber, urlsFor);
        if (!ok) {
          if (!broken.has(item) && !this.stopped) {
            broken.add(item);
            this.failedFiles.add(item.drop);
            this.emit({ failed: this.progress.failed + 1 });
          }
          continue;
        }
        const left = (remaining.get(item) ?? 1) - 1;
        remaining.set(item, left);
        if (left === 0) await this.complete(item);
      }
    };
    await Promise.all(Array.from({ length: PARTS_IN_FLIGHT }, work));
  }

  private async partUrls(item: Item): Promise<Map<number, string> | null> {
    const res = await this.call<PartUrlsResponse>(`/upload-batches/${this.batchId}/part-urls`, {
      method: "POST",
      body: { items: [{ photoId: item.photoId, partNumbers: item.missing }] },
    });
    if (!res.ok) return null;
    return new Map(res.data.urls.map((u) => [u.partNumber, u.url]));
  }

  private async sendPart(
    item: Item,
    partNumber: number,
    urlsFor: (item: Item, refresh?: boolean) => Promise<Map<number, string> | null>,
  ): Promise<boolean> {
    const { start, end } = partRange(item.size, partNumber);
    let refreshed = false;
    for (let attempt = 1; attempt <= TRIES && !this.stopped; attempt++) {
      await this.waitOnline();
      const url = (await urlsFor(item))?.get(partNumber);
      if (!url) return false;
      const status = await this.deps.put(url, item.file.slice(start, end));
      if (status >= 200 && status < 300) return true;
      if (status === 403 && !refreshed) {
        // The URL expired (15 minutes): sign new ones once.
        refreshed = true;
        await urlsFor(item, true);
        continue;
      }
      if (!retryable(status)) return false;
      await this.deps.sleep(retryDelay(attempt));
    }
    return false;
  }

  private async complete(item: Item): Promise<void> {
    for (let round = 0; round < 2; round++) {
      const res = await this.call<UploadCompleteResponse>(
        `/photos/${item.photoId}/upload-complete`,
        {
          method: "POST",
        },
      );
      // An earlier try (or another tab) already finished it: it's uploaded.
      const done = res.ok
        ? res.data.status === "processing"
        : res.fields.form === "photos.notUploading";
      if (res.ok || done) {
        if (done) {
          this.uploadedItems.add(item);
          this.emit({ uploaded: this.progress.uploaded + 1 });
        } else {
          this.failedFiles.add(item.drop);
          this.emit({ failed: this.progress.failed + 1 });
        }
        return;
      }
      if (res.fields.form !== "photos.incomplete") break;
      // A part went missing in transit: send what storage doesn't have, then try once more.
      const parts = await this.call<UploadPartsResponse>(`/photos/${item.photoId}/upload-parts`);
      if (!parts.ok) break;
      item.missing = Array.from({ length: item.partCount }, (_, n) => n + 1).filter(
        (n) => !parts.data.parts.includes(n),
      );
      let fresh: Promise<Map<number, string> | null> | null = null;
      const urlsFor = (_: Item, refresh = false) => {
        if (refresh || !fresh) fresh = this.partUrls(item);
        return fresh;
      };
      for (const n of item.missing) if (!(await this.sendPart(item, n, urlsFor))) break;
    }
    this.failedFiles.add(item.drop);
    this.emit({ failed: this.progress.failed + 1 });
  }

  private async finish(): Promise<void> {
    this.emit({ phase: "finishing" });
    await this.call(`/upload-batches/${this.batchId}/finish`, {
      method: "POST",
      body: { skipped: this.progress.skipped, duplicates: this.dropDuplicates },
    });
    this.emit({ phase: this.stopped ? "stopped" : "done" });
  }
}

// ── Browser glue ──────────────────────────────────────────────────────────────────────────────────────────────────

async function readEntry(entry: FileSystemEntry, out: DropFile[]): Promise<void> {
  if (entry.isFile) {
    const file = await new Promise<File>((ok, fail) =>
      (entry as FileSystemFileEntry).file(ok, fail),
    );
    out.push({ file, path: entry.fullPath.replace(/^\/+/, "") });
    return;
  }
  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    // readEntries returns at most 100 entries a call: keep calling until it returns none.
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((ok, fail) =>
        reader.readEntries(ok, fail),
      );
      if (batch.length === 0) break;
      for (const child of batch) await readEntry(child, out);
    }
  }
}

/** Every file in a drop, folders read all the way down. */
export async function filesFromDrop(data: DataTransfer): Promise<DropFile[]> {
  // Entries must be taken before the first await: the drop's data is gone afterwards.
  const entries = Array.from(data.items)
    .map((item) => item.webkitGetAsEntry())
    .filter((e): e is FileSystemEntry => e !== null);
  if (entries.length === 0) return Array.from(data.files, (file) => ({ file, path: file.name }));
  const out: DropFile[] = [];
  for (const entry of entries) await readEntry(entry, out);
  return out;
}

/** Files from a file input; a folder input gives each file's path inside the folder. */
export function filesFromInput(list: FileList | null): DropFile[] {
  return Array.from(list ?? [], (file) => ({
    file,
    path: (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name,
  }));
}

/**
 * The hashing worker's script: it reads a File and answers its SHA-256. Made from this string (a Blob URL) so it runs
 * the same in development and production builds, with nothing to bundle. The file never leaves the browser here.
 */
const HASH_WORKER = `
self.onmessage = async (event) => {
  const { id, file } = event.data;
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    const sha256 = Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
    self.postMessage({ id, sha256 });
  } catch {
    self.postMessage({ id, sha256: null });
  }
};
`;

async function hashHere(file: File): Promise<string | null> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

/**
 * A small pool of Web Workers that hash files off the main thread. Without workers (or if one fails), files are
 * hashed on the main thread instead; WebCrypto does the work in the background either way.
 */
export function workerHasher(size = HASHING_IN_PARALLEL): {
  hash: (file: File) => Promise<string | null>;
  close: () => void;
} {
  let url: string | null = null;
  let workers: Worker[] = [];
  try {
    url = URL.createObjectURL(new Blob([HASH_WORKER], { type: "text/javascript" }));
    workers = Array.from({ length: size }, () => new Worker(url as string));
  } catch {
    workers = [];
  }
  const waiting = new Map<
    number,
    { file: File; done: (sha: string | null) => void; worker: Worker }
  >();
  for (const w of workers) {
    w.onmessage = (e: MessageEvent<{ id: number; sha256: string | null }>) => {
      waiting.get(e.data.id)?.done(e.data.sha256);
      waiting.delete(e.data.id);
    };
    // A worker that can't run: its files are hashed here instead, and it takes no more.
    w.onerror = () => {
      workers = workers.filter((x) => x !== w);
      for (const [n, job] of waiting)
        if (job.worker === w) {
          waiting.delete(n);
          void hashHere(job.file).then(job.done);
        }
    };
  }
  let id = 0;
  return {
    hash(file) {
      const n = id++;
      const worker = workers[n % Math.max(workers.length, 1)];
      if (!worker) return hashHere(file);
      return new Promise((done) => {
        waiting.set(n, { file, done, worker });
        worker.postMessage({ id: n, file });
      });
    },
    close() {
      for (const w of workers) w.terminate();
      if (url) URL.revokeObjectURL(url);
    },
  };
}

/** PUTs one part straight to storage. No credentials: the URL itself is the permission. */
export async function putPart(url: string, body: Blob): Promise<number> {
  try {
    const res = await fetch(url, { method: "PUT", body, credentials: "omit" });
    return res.status;
  } catch {
    return 0;
  }
}

export function whenOnline(): Promise<void> {
  if (typeof navigator === "undefined" || navigator.onLine) return Promise.resolve();
  return new Promise((ok) => window.addEventListener("online", () => ok(), { once: true }));
}
