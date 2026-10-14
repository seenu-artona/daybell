import "server-only";
import { once } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { ApiError, SHOP_CONFLICTS } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  DOWNLOAD_VARIANT,
  MAX_ZIP_FILES,
  type PrintManifestRow,
  photoKey,
  printFileName,
  printManifest,
  zipEntryName,
  zipFileName,
} from "@daybell/core";
import archiver from "archiver";
import { DOWNLOAD_PREPARING_SECONDS, queueDownloads } from "../checkout/downloads";
import { photoDownloadStorage, photoStorage } from "../photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "../region-guard";
import { ConflictLater, callShopFunction } from "../shop/http";
import type { ShopCookieSession } from "../shop/session";
import { orderWriteRpc } from "../supabase/service";
import { orderCheck } from "./errors";

/**
 * Zips (ADR 0024; Claude's calls): a parent's "Download all" and the studio's print files. Streamed from the studio's
 * region (D113: from Montréal, out of ca-central-1), one file at a time and never all in memory, in store mode (JPEGs
 * don't compress). Read with the download role, which may read download.jpg only (ADR 0023). Every file must exist
 * first: a missing one is asked for (lazily made, at most every 5 minutes and 3 times) and the request answered 409
 * with Retry-After, never a partial zip. Named by the order's reference, never a child. At most 500 files; 10 zips an
 * hour per gallery or person and 20 per order (the database counts a zip only when it is streamed, never a 409:
 * code review N1, security review S4). A browser that goes away stops the zip: the archive and the file being read
 * are destroyed at once. Logs hold fixed names only.
 */

interface ZipEntry {
  name: string;
  /** The file, opened only when its turn comes. */
  open: () => Promise<Readable | string>;
}

/**
 * A zip streamed as it is made. A failure part way cuts the stream (the browser says the download failed). The
 * request's signal, or the browser no longer reading (the stream cancelled), stops it: the archive is aborted and the
 * file being read destroyed, so no storage stream stays open (security review S4).
 */
export function zipResponse(
  filename: string,
  entries: readonly ZipEntry[],
  signal?: AbortSignal,
): Response {
  const archive = archiver("zip", { store: true });
  const out = new PassThrough();
  const stop = new AbortController();
  let current: Readable | null = null;
  let done = false;
  const halt = () => {
    if (stop.signal.aborted) return;
    stop.abort();
    current?.destroy();
    archive.abort();
    if (!out.destroyed) out.destroy();
  };
  archive.on("warning", () => console.error("zip_warning"));
  archive.pipe(out);
  out.on("close", () => {
    if (!done) halt();
  });
  if (signal) {
    if (signal.aborted) halt();
    else signal.addEventListener("abort", halt, { once: true });
  }
  void (async () => {
    try {
      for (const entry of entries) {
        if (stop.signal.aborted) return;
        const source = await entry.open();
        current = typeof source === "string" ? null : source;
        if (stop.signal.aborted) {
          current?.destroy();
          return;
        }
        // One at a time: the next file is opened once archiver has taken this one (listened for before appending).
        const taken = once(archive, "entry", { signal: stop.signal });
        archive.append(source, { name: entry.name });
        await taken;
      }
      done = true;
      await archive.finalize();
    } catch {
      if (stop.signal.aborted) {
        console.warn("zip_stopped");
        return;
      }
      console.error("zip_failed");
      archive.abort();
      out.destroy(new Error("zip_failed"));
    }
  })();
  return new Response(Readable.toWeb(out) as ReadableStream<Uint8Array>, {
    headers: {
      "content-type": "application/zip",
      "content-disposition": `attachment; filename="${filename}"`,
      "cache-control": "no-store",
    },
  });
}

/** Which of the files storage lacks (a few at a time, by listing: the app's role never reads them). */
async function missing(
  region: DataRegion,
  files: readonly { key: string; photoId: string }[],
): Promise<string[]> {
  const storage = photoStorage(region);
  const lacking: string[] = [];
  for (let i = 0; i < files.length; i += 10) {
    const batch = files.slice(i, i + 10);
    const heads = await Promise.all(batch.map((f) => storage.head(f.key)));
    batch.forEach((f, j) => {
      if (!heads[j]) lacking.push(f.photoId);
    });
  }
  return [...new Set(lacking)];
}

/** After asking for the missing files: unavailable for good (alerted), or being made (try again shortly). */
async function refuseMissing(
  region: DataRegion,
  asked: { queued: string[]; unavailable: number },
): Promise<never> {
  if (asked.unavailable > 0) {
    console.error("download_unavailable");
    throw new ApiError("conflict", "A file isn't available right now.", {
      form: SHOP_CONFLICTS.downloadUnavailable,
    });
  }
  await queueDownloads(region, asked.queued);
  throw new ConflictLater(DOWNLOAD_PREPARING_SECONDS, "The files are being prepared.", {
    form: SHOP_CONFLICTS.downloadPreparing,
  });
}

const tooBig = () =>
  new ApiError("conflict", "Too many files for one zip: download them one at a time.", {
    form: SHOP_CONFLICTS.zipTooBig,
  });

/** A parent's "Download all": every paid download this gallery may have, named as the single downloads are. */
export async function downloadAll(
  session: ShopCookieSession,
  orderId: string,
  signal?: AbortSignal,
): Promise<Response> {
  const found = await callShopFunction<{
    studio_id: string;
    reference: string;
    files: { job_id: string; photo_id: string; n: number }[];
  }>(session.region, "shop_order_download_all", {
    p_session_hash: session.hash,
    p_order_id: orderId,
  });
  if (found.files.length === 0) throw new ApiError("not_found", "Nothing to download.");
  if (found.files.length > MAX_ZIP_FILES) throw tooBig();
  assertStorageRegion(session.region);
  const files = found.files.map((f) => ({
    photoId: f.photo_id,
    n: Number(f.n),
    key: photoKey(
      { studioId: found.studio_id, jobId: f.job_id, photoId: f.photo_id },
      DOWNLOAD_VARIANT,
    ),
  }));
  const lacking = await missing(session.region, files);
  if (lacking.length > 0)
    await refuseMissing(
      session.region,
      await callShopFunction(session.region, "shop_download_all_request", {
        p_session_hash: session.hash,
        p_order_id: orderId,
        p_photo_ids: lacking,
      }),
    );
  // Counted only now, when it is streamed (zip_limit: 10 a gallery and 20 an order an hour).
  await callShopFunction(session.region, "shop_zip_take", {
    p_session_hash: session.hash,
    p_order_id: orderId,
  });
  const storage = photoDownloadStorage(session.region);
  return zipResponse(
    zipFileName(found.reference, "downloads"),
    files.map((f) => ({
      name: zipEntryName(found.reference, f.n),
      open: () => storage.getStream(f.key),
    })),
    signal,
  );
}

interface DbPrintFile {
  position: number;
  job_id: string | null;
  photo_id: string | null;
  kind: string;
  name: string;
  print_size: string | null;
  quantity: number;
  contents: { print_size: string; quantity: number }[];
}

/**
 * The studio's print files (owners, admins and staff): the full-resolution photo of each line left to print, and a
 * manifest.csv saying what to print, with no names.
 */
export async function printFiles(
  region: DataRegion,
  actorId: string,
  studioId: string,
  orderId: string,
  signal?: AbortSignal,
): Promise<Response> {
  assertFunctionRegion(region);
  const found = orderCheck<{ reference: string; files: DbPrintFile[] }>(
    await orderWriteRpc(region, "order_print_files", actorId, {
      p_studio_id: studioId,
      p_order_id: orderId,
    }),
  );
  if (found.files.length === 0) throw new ApiError("not_found", "Nothing left to print.");
  if (found.files.length > MAX_ZIP_FILES) throw tooBig();
  assertStorageRegion(region);
  const files = found.files.map((f) => ({
    ...f,
    key:
      f.photo_id && f.job_id
        ? photoKey({ studioId, jobId: f.job_id, photoId: f.photo_id }, DOWNLOAD_VARIANT)
        : null,
    file: f.photo_id
      ? printFileName(found.reference, f.position, f.print_size, Number(f.quantity))
      : null,
  }));
  const withPhoto = files.flatMap((f) =>
    f.key && f.photo_id ? [{ key: f.key, photoId: f.photo_id }] : [],
  );
  const lacking = await missing(region, withPhoto);
  if (lacking.length > 0)
    await refuseMissing(
      region,
      orderCheck(
        await orderWriteRpc(region, "order_print_files_to_make", actorId, {
          p_studio_id: studioId,
          p_order_id: orderId,
          p_photo_ids: lacking,
        }),
      ),
    );
  const manifest: PrintManifestRow[] = files.map((f) => ({
    file: f.file,
    position: f.position,
    item: f.name,
    size: f.print_size,
    quantity: Number(f.quantity),
    contents: f.contents.map((c) => `${c.print_size} x${c.quantity}`).join("; "),
  }));
  // Counted only now, when it is streamed (zip_limit: 10 a person and 20 an order an hour).
  orderCheck(
    await orderWriteRpc(region, "order_zip_take", actorId, {
      p_studio_id: studioId,
      p_order_id: orderId,
    }),
  );
  const storage = photoDownloadStorage(region);
  return zipResponse(
    zipFileName(found.reference, "print-files"),
    [
      ...files.flatMap((f) =>
        f.key && f.file ? [{ name: f.file, open: () => storage.getStream(f.key as string) }] : [],
      ),
      { name: "manifest.csv", open: async () => printManifest(manifest) },
    ],
    signal,
  );
}
