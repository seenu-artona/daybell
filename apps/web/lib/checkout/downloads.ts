import "server-only";
import { ApiError, type DownloadLinkResponse, SHOP_CONFLICTS } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import { DOWNLOAD_LINK_SECONDS, DOWNLOAD_VARIANT, downloadFileName, photoKey } from "@daybell/core";
import {
  isLocalDriver,
  photoDownloadStorage,
  photoStorage,
  queueDownloadForProcessing,
} from "../photo-storage";
import { assertStorageRegion } from "../region-guard";
import { ConflictLater, callShopFunction } from "../shop/http";
import type { ShopCookieSession } from "../shop/session";
import { checkoutSystemRpc } from "../supabase/service";

/**
 * A parent's paid download (ADR 0023; calls 10, 11): the database says whether this gallery may have the photo (a
 * paid order it may see, a digital line it shows); the link is to `download.jpg` (full resolution, metadata stripped,
 * never the original), signed by the download role for 5 minutes, saved under a name with the order's reference and
 * a number only. Signed in Montréal from ca-central-1 (D113).
 *
 * `download.jpg` is made lazily, only for photos that were sold (security review N1): asked for when the order is
 * paid (queuePaidDownloads), and again when a paid download finds it missing. The database stamps each request, so a
 * photo is queued at most once every 5 minutes and 3 times in all (code review S4, security review S5): meanwhile 409
 * shop.downloadPreparing with Retry-After; after that 409 shop.downloadUnavailable, alerted (download_unavailable).
 * Queue messages carry the photo's id only (D113).
 */

/** How long a parent waits before trying a download that is being made. */
export const DOWNLOAD_PREPARING_SECONDS = 20;

/**
 * Makes the files with the local driver, one at a time, after the response (development, CI and end-to-end tests):
 * there is no queue, and sharp decodes full resolution, so never several at once.
 */
let localChain: Promise<void> = Promise.resolve();
function makeLocally(region: DataRegion, photoIds: readonly string[]): void {
  localChain = localChain.then(async () => {
    const { makeDownloadLocally } = await import("../photos");
    for (const id of photoIds) await makeDownloadLocally(region, photoStorage(region), id);
  });
}

/** Queues the files' making (ids only), or makes them here one at a time with the local driver. */
export async function queueDownloads(
  region: DataRegion,
  photoIds: readonly string[],
): Promise<void> {
  if (photoIds.length === 0) return;
  if (isLocalDriver(region)) {
    makeLocally(region, photoIds);
    return;
  }
  for (const id of photoIds) await queueDownloadForProcessing(region, id);
}

/**
 * Asks for the paid order's download files (each once; the database marks them asked). Never fails the payment: a
 * failure is logged by name, and the first download asks again.
 */
export async function queuePaidDownloads(region: DataRegion, orderId: string): Promise<void> {
  try {
    const { data, error } = await checkoutSystemRpc(region, "order_downloads_to_make", {
      p_order_id: orderId,
    });
    if (error) throw error;
    const ids = Array.isArray(data)
      ? data.filter((id): id is string => typeof id === "string")
      : [];
    await queueDownloads(region, ids);
  } catch {
    console.error("download_queue_failed");
  }
}

export async function downloadLink(
  session: ShopCookieSession,
  orderId: string,
  photoId: string,
): Promise<DownloadLinkResponse> {
  const row = await callShopFunction<{
    studio_id: string;
    job_id: string;
    photo_id: string;
    reference: string;
    n: number;
  }>(session.region, "shop_download_photo", {
    p_session_hash: session.hash,
    p_order_id: orderId,
    p_photo_id: photoId,
  });
  assertStorageRegion(session.region);
  const ids = { studioId: row.studio_id, jobId: row.job_id, photoId: row.photo_id };
  const key = photoKey(ids, DOWNLOAD_VARIANT);
  // Looked for with the app's usual role (by listing): the download role can read download.jpg and nothing else.
  if (!(await photoStorage(session.region).head(key))) {
    const asked = await callShopFunction<"queued" | "waiting" | "unavailable">(
      session.region,
      "shop_download_request",
      { p_session_hash: session.hash, p_order_id: orderId, p_photo_id: photoId },
    );
    if (asked === "unavailable") {
      // The worker had its chances (or the photo isn't ready): support looks. A fixed name, never an id or a name.
      console.error("download_unavailable");
      throw new ApiError("conflict", "This download isn't available right now.", {
        form: SHOP_CONFLICTS.downloadUnavailable,
      });
    }
    if (asked === "queued") await queueDownloads(session.region, [row.photo_id]);
    throw new ConflictLater(DOWNLOAD_PREPARING_SECONDS, "This download is being prepared.", {
      form: SHOP_CONFLICTS.downloadPreparing,
    });
  }
  const signedAt = new Date();
  const url = await photoDownloadStorage(session.region).presignGet(key, {
    expiresIn: DOWNLOAD_LINK_SECONDS,
    signedAt,
    download: { filename: downloadFileName(row.reference, Number(row.n)) },
  });
  return {
    url,
    expiresAt: new Date(signedAt.getTime() + DOWNLOAD_LINK_SECONDS * 1000).toISOString(),
  };
}
