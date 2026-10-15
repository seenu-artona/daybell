import "server-only";
import type { DataRegion } from "@daybell/config";
import { drmKmsKeyArn } from "@daybell/config/server";
import { queueDrmForProcessing } from "./photo-storage";
import { photoSystemRpc } from "./supabase/service";

/**
 * DRM packaging requests (D158; ADR 0034). Packaging is on in an environment once its KMS key is set
 * (DRM_KMS_KEY_ARN_CA) with S3 storage; the shop's switch (set_shop_drm) only decides whether parents see the clips,
 * so they are ready the moment it is turned on. Locally, and where the key isn't set, nothing is requested. Logs name
 * a variable, a photo id or a reason: never more.
 */
export function drmPackagingOn(region: DataRegion): boolean {
  try {
    return drmKmsKeyArn(region) !== null;
  } catch (err) {
    // The message names the variable, never a value.
    console.error("drm_misconfigured", err instanceof Error ? err.message : "unknown");
    return false;
  }
}

/**
 * Requests a photo's clip (after a new ready result: its proofs were remade, and record_photo_result dropped the old
 * clip) and queues it. A photo that can't be shown to parents (a card, binned) isn't requested. A failure to queue is
 * left for the daily cron, which re-queues requests unanswered for an hour.
 */
export async function requestDrm(region: DataRegion, photoId: string): Promise<void> {
  if (!drmPackagingOn(region)) return;
  const { data, error } = await photoSystemRpc(region, "photo_drm_requested", {
    p_photo_id: photoId,
  });
  if (error || data === null || data === undefined) return;
  try {
    await queueDrmForProcessing(region, photoId);
  } catch (err) {
    console.error("drm_queue_failed", photoId, err instanceof Error ? err.name : "unknown");
  }
}
