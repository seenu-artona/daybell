import { ApiError } from "@daybell/api";
import { shopDrmSetup } from "@/lib/shop/drm";
import { requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "yul1";

/**
 * GET /api/v1/shop/drm/fairplay-certificate — the FairPlay (FPS) certificate Safari asks for before a license (D158;
 * ADR 0034, C10), from SHOP_DRM_FAIRPLAY_CERT, served from this site so the shop's policy needs no other host. For a
 * parent's session; not found while FairPlay isn't set up.
 */
export const GET = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request);
  const certificate = shopDrmSetup(session.region)?.settings.fairplayCertificate;
  if (!certificate) throw new ApiError("not_found", "Not found.");
  return new Response(new Uint8Array(certificate), {
    headers: { "content-type": "application/octet-stream" },
  });
});
