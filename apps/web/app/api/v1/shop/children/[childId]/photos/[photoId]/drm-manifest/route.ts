import { ApiError } from "@daybell/api";
import {
  DRM_MANIFEST_FORMATS,
  DRM_MANIFEST_SECONDS,
  DRM_MANIFEST_VARIANT,
  DrmManifestError,
  type DrmManifestFormat,
  drmObjectKey,
  rewriteDashManifest,
  rewriteHlsMaster,
  rewriteHlsMedia,
} from "@daybell/core";
import { StorageError } from "@daybell/storage";
import { z } from "zod";
import { photoStorage } from "@/lib/photo-storage";
import { assertStorageRegion } from "@/lib/region-guard";
import { drmUnavailable, shopDrmSetup } from "@/lib/shop/drm";
import { callShopFunction, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Canadian photos are read and signed in Montréal from S3 ca-central-1 (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ childId: string; photoId: string }> };

const CONTENT_TYPE: Record<DrmManifestFormat, string> = {
  dash: "application/dash+xml",
  hls: "application/vnd.apple.mpegurl",
  "hls-media": "application/vnd.apple.mpegurl",
};

/**
 * GET /api/v1/shop/children/:childId/photos/:photoId/drm-manifest?format=dash|hls|hls-media — a protected large view's
 * manifest (D158; ADR 0034), read from S3 with the clip's address signed for 10 minutes. The HLS master's one variant
 * points back here (format=hls-media, same gallery). Only a photo the child's parent may see (shop_drm_photo); anything
 * else is not found; 409 shop.drmUnavailable while it isn't protected, or when the stored manifest isn't exactly the
 * packager's for the database's key. Never cached.
 */
export const GET = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request, "drm");
  const { childId, photoId } = await ctx.params;
  if (!z.uuid().safeParse(childId).success || !z.uuid().safeParse(photoId).success)
    throw new ApiError("not_found", "Photo not found.");
  const format = new URL(request.url).searchParams.get("format");
  if (!(DRM_MANIFEST_FORMATS as readonly (string | null)[]).includes(format))
    throw new ApiError("invalid_input", "Please check what you sent.", {
      format: "validation.invalid",
    });
  const chosen = format as DrmManifestFormat;
  if (!shopDrmSetup(session.region)) throw drmUnavailable();
  const row = await callShopFunction<{
    studio_id: string;
    job_id: string;
    photo_id: string;
    key_id: string;
  }>(session.region, "shop_drm_photo", {
    p_session_hash: session.hash,
    p_child_id: childId,
    p_photo_id: photoId,
  });
  assertStorageRegion(session.region);
  const storage = photoStorage(session.region);
  const ids = { studioId: row.studio_id, jobId: row.job_id, photoId: row.photo_id };
  // Only the files the database's key names (drm/{key}.*), and only a manifest for that key (review H1).
  const keyId = row.key_id;
  let bytes: Uint8Array;
  try {
    bytes = await storage.get(drmObjectKey(ids, keyId, DRM_MANIFEST_VARIANT[chosen]));
  } catch (err) {
    if (!(err instanceof StorageError && err.code === "not_found")) throw err;
    console.error("shop_drm_manifest_missing");
    throw drmUnavailable();
  }
  const stored = new TextDecoder().decode(bytes);
  const clip = () =>
    storage.presignGet(drmObjectKey(ids, keyId, "drm.mp4"), { expiresIn: DRM_MANIFEST_SECONDS });
  let body: string;
  try {
    if (chosen === "dash") body = rewriteDashManifest(stored, await clip(), keyId);
    else if (chosen === "hls-media") body = rewriteHlsMedia(stored, await clip(), keyId);
    else {
      const media = new URLSearchParams({ format: "hls-media", gallery: session.galleryId });
      body = rewriteHlsMaster(
        stored,
        `/api/v1/shop/children/${childId}/photos/${photoId}/drm-manifest?${media.toString()}`,
      );
    }
  } catch (err) {
    if (!(err instanceof DrmManifestError)) throw err;
    // A fixed name only; the parent's viewer falls back to the WebP.
    console.error("shop_drm_manifest_mismatch");
    throw drmUnavailable();
  }
  return new Response(body, { headers: { "content-type": CONTENT_TYPE[chosen] } });
});
