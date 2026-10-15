import { ApiError, type ShopDrmTokenResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertStorageRegion } from "@/lib/region-guard";
import { drmUnavailable, shopDrmSetup, unwrapContentKey } from "@/lib/shop/drm";
import { licenseToken } from "@/lib/shop/drm-token";
import { callShopFunction, RetryLater, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Keys are unwrapped by KMS in ca-central-1 and tokens signed in Montréal (D113).
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ childId: string; photoId: string }> };

type KeyRow =
  | { rate_limited: true; retry_after: number }
  | {
      studio_id: string;
      photo_id: string;
      key_id: string;
      wrapped_key: string;
      kms_key_arn: string;
    };

/**
 * POST /api/v1/shop/children/:childId/photos/:photoId/drm-token — a 60-second Axinom license token for one protected
 * large view (D158; ADR 0034). The database checks the entitlement (the photo is one the child's parent may see, else
 * not found) and the gallery's budget (60 a minute, 1,500 a day: 429 with Retry-After), and returns the photo's key
 * wrapped by KMS; KMS unwraps it with the DRM role and the encryption context {studio, photo, key}; the plaintext lives
 * only in memory until the token is signed, then is zeroed. No name, code, studio, child or photo id is in the token.
 * Nothing about it is logged.
 */
export const POST = shopHandle(async (request: Request, ctx: Ctx) => {
  const session = await requireShopSession(request);
  const { childId, photoId } = await ctx.params;
  if (!z.uuid().safeParse(childId).success || !z.uuid().safeParse(photoId).success)
    throw new ApiError("not_found", "Photo not found.");
  const setup = shopDrmSetup(session.region);
  if (!setup) throw drmUnavailable();
  const row = await callShopFunction<KeyRow>(session.region, "shop_drm_key", {
    p_session_hash: session.hash,
    p_child_id: childId,
    p_photo_id: photoId,
  });
  if ("rate_limited" in row) {
    // A fixed name only: never the gallery, the child or the photo.
    console.warn("shop_drm_rate_limited");
    throw new RetryLater(row.retry_after, "Too many photos opened. Wait a moment and try again.");
  }
  assertStorageRegion(session.region);
  const contentKey = await unwrapContentKey(setup, {
    studioId: row.studio_id,
    photoId: row.photo_id,
    keyId: row.key_id,
    wrappedKey: row.wrapped_key,
    kmsKeyArn: row.kms_key_arn,
  });
  try {
    const body: ShopDrmTokenResponse = licenseToken(setup.settings, {
      keyId: row.key_id,
      contentKey,
    });
    return NextResponse.json(body);
  } finally {
    contentKey.fill(0);
  }
});
