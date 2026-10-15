import type { ShopDrmConfigResponse } from "@daybell/api";
import { DRM_CODEC } from "@daybell/core";
import { NextResponse } from "next/server";
import { shopDrmSetup } from "@/lib/shop/drm";
import { licenseUrls } from "@/lib/shop/drm-token";
import { callShopFunction, requireShopSession, shopHandle } from "@/lib/shop/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// Canadian studios' settings are read in Montréal (D113).
export const preferredRegion = "yul1";

/** Where the FairPlay certificate is served, from this site (C10). */
export const FAIRPLAY_CERTIFICATE_PATH = "/api/v1/shop/drm/fairplay-certificate";

/**
 * GET /api/v1/shop/drm — whether the gallery's large views may be protected (D158; ADR 0034): the switch in the
 * gallery's database is on and DRM is set up in this region. With it, Axinom's license servers and this site's FairPlay
 * certificate address. Off, every large view is the watermarked WebP. Nothing about the parent or child.
 */
export const GET = shopHandle(async (request: Request) => {
  const session = await requireShopSession(request, "drm");
  const setup = shopDrmSetup(session.region);
  // The switch for this gallery's studio (on for every studio, or only for those listed: ADR 0034, review M1/M2).
  const switchedOn = setup
    ? await callShopFunction<boolean>(session.region, "shop_drm_enabled_for", {
        p_session_hash: session.hash,
      })
    : false;
  const enabled = Boolean(setup && switchedOn);
  const fairplay = Boolean(setup?.settings.fairplayCertificate);
  const body: ShopDrmConfigResponse = {
    enabled,
    licenseUrls: enabled && setup ? licenseUrls(setup.settings.licensePrefix, fairplay) : null,
    fairplayCertificateUrl: enabled && fairplay ? FAIRPLAY_CERTIFICATE_PATH : null,
    codec: DRM_CODEC,
  };
  return NextResponse.json(body);
});
