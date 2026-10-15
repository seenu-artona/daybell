import { ApiError, type DrmTestTokenResponse } from "@daybell/api";
import { type DrmTestSettings, drmTestPageEnabled, drmTestSettings } from "@daybell/config/server";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { licenseToken, licenseUrls } from "@/lib/drm-test";
import { assertCanManage, studioScope } from "@/lib/studio";

// Signing runs in Montréal like the rest of Canada's work (D113). No studio data is read or sent: the token carries
// only the test clip's key ID, its wrapped key and the policy.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const preferredRegion = "yul1";

function settings(): DrmTestSettings {
  try {
    return drmTestSettings();
  } catch (err) {
    // The message names the variable, never its value (packages/config).
    console.error("drm_test_config", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "The DRM test page isn't set up here.");
  }
}

/**
 * POST /api/v1/dev/drm-test/token: a license token for /dev/drm-test (spike; D158; ADR 0032). Off unless
 * DRM_TEST_PAGE_ENABLED is true, and then for owners and admins only. The flag is read before anything else, so a
 * disabled environment answers like a route that doesn't exist. The token and keys are never logged.
 */
export const POST = handle(async (_request: Request) => {
  if (!drmTestPageEnabled()) throw new ApiError("not_found", "Not found.");
  const { studio } = await studioScope();
  assertCanManage(studio);
  const config = settings();
  const { token, expiresAt } = licenseToken(config);
  const body: DrmTestTokenResponse = {
    token,
    expiresAt,
    licenseUrls: licenseUrls(config.licensePrefix, config.fairplayCertificateUrl !== null),
    fairplayCertificateUrl: config.fairplayCertificateUrl,
  };
  return NextResponse.json(body, { headers: { "cache-control": "no-store" } });
});
