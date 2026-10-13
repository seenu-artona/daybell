import "server-only";
import { type DownloadLinkResponse, SHOP_CONFLICTS } from "@daybell/api";
import { DOWNLOAD_LINK_SECONDS, DOWNLOAD_VARIANT, downloadFileName, photoKey } from "@daybell/core";
import {
  isLocalDriver,
  photoDownloadStorage,
  photoStorage,
  queueDownloadForProcessing,
} from "../photo-storage";
import { makeDownloadLocally } from "../photos";
import { assertStorageRegion } from "../region-guard";
import { ConflictLater, callShopFunction } from "../shop/http";
import type { ShopCookieSession } from "../shop/session";

/**
 * A parent's paid download (ADR 0023; calls 10, 11): the database says whether this gallery may have the photo (a
 * paid order it may see, a digital line it shows); the link is to `download.jpg` (full resolution, metadata stripped,
 * never the original), signed by the download role for 5 minutes, saved under a name with the order's reference and
 * a number only. A photo processed before downloads existed gets its file made first (the backfill): 409
 * shop.downloadPreparing with Retry-After until it is there. Signed in Montréal from ca-central-1 (D113).
 */

/** How long a parent waits before trying a download that is being made. */
export const DOWNLOAD_PREPARING_SECONDS = 20;

export async function downloadLink(
  session: ShopCookieSession,
  orderId: string,
  photoId: string,
  after: (work: () => Promise<void>) => void,
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
    if (isLocalDriver(session.region))
      after(() => makeDownloadLocally(session.region, photoStorage(session.region), row.photo_id));
    else await queueDownloadForProcessing(session.region, row.photo_id);
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
