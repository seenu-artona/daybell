/**
 * The parent shop's Content-Security-Policy (security review L2; ADR 0022 §5): the browser itself enforces "no
 * third-party scripts" (only this site's scripts carrying the page's nonce, and what they load) and the Canada-only
 * image source (D113): this site, and Canada's S3 bucket in ca-central-1. Nothing may frame the shop, post a form
 * elsewhere or change the base URL. Styles may be inline (React's style attributes and Next's own); scripts may not.
 * Read from the environment directly (the proxy runs before any route; no server-only module here).
 *
 * The large view's DRM (D158; ADR 0034): media from this site (the HLS playlists), blob: (Media Source Extensions) and
 * the bucket (the clip, played natively by Safari); and, only once the shop's Axinom tenant is set, connections to the
 * bucket (Shaka fetches the clip's byte ranges) and to exactly the tenant's three license hosts. Shaka needs neither
 * 'unsafe-eval' nor a worker for fMP4 clips (its worker only transmuxes MPEG-2 TS).
 */
export function shopImageSources(env: Record<string, string | undefined> = process.env): string[] {
  if (env.STORAGE_DRIVER?.trim() !== "s3") return [];
  // Photo storage exists for Canada only, in ca-central-1 (ADR 0016; @daybell/config's PHOTO_AWS_REGION).
  const bucket = env.PHOTO_BUCKET_CA?.trim();
  return bucket && /^[a-z0-9.-]{3,63}$/.test(bucket)
    ? [`https://${bucket}.s3.ca-central-1.amazonaws.com`]
    : [];
}

/** The tenant prefix rule of packages/config's shopDrmSettings, repeated here (no server-only module in the proxy). */
const LICENSE_PREFIX = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

/** Axinom's license hosts for the shop's tenant, or none while SHOP_DRM_LICENSE_PREFIX isn't set (or is malformed). */
export function shopLicenseSources(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const prefix = env.SHOP_DRM_LICENSE_PREFIX?.trim().toLowerCase() ?? "";
  if (!LICENSE_PREFIX.test(prefix)) return [];
  return ["widevine", "playready", "fairplay"].map(
    (system) => `https://${prefix}.drm-${system}-licensing.axprod.net`,
  );
}

export function shopContentSecurityPolicy(
  nonce: string,
  options: { dev?: boolean; imageSources?: string[]; licenseSources?: string[] } = {},
): string {
  const images = options.imageSources ?? shopImageSources();
  const licenses = options.licenseSources ?? shopLicenseSources();
  // The clip's byte ranges are fetched only when DRM can be on at all.
  const connect = licenses.length > 0 ? [...images, ...licenses] : [];
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' blob: data:", ...images].join(" "),
    ["media-src 'self' blob:", ...images].join(" "),
    "font-src 'self'",
    ["connect-src 'self'", ...connect].join(" "),
    "object-src 'none'",
    "frame-ancestors 'none'",
    "base-uri 'none'",
    "form-action 'self'",
  ].join("; ");
}

/** A fresh nonce per page: 16 random bytes, base64. */
export function newNonce(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return btoa(String.fromCharCode(...bytes));
}
