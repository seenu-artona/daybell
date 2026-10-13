/**
 * The parent shop's Content-Security-Policy (security review L2; ADR 0022 §5): the browser itself enforces "no
 * third-party scripts" (only this site's scripts carrying the page's nonce, and what they load) and the Canada-only
 * image source (D113): this site, and Canada's S3 bucket in ca-central-1. Nothing may frame the shop, post a form
 * elsewhere or change the base URL. Styles may be inline (React's style attributes and Next's own); scripts may not.
 * Read from the environment directly (the proxy runs before any route; no server-only module here).
 */
export function shopImageSources(env: Record<string, string | undefined> = process.env): string[] {
  if (env.STORAGE_DRIVER?.trim() !== "s3") return [];
  // Photo storage exists for Canada only, in ca-central-1 (ADR 0016; @daybell/config's PHOTO_AWS_REGION).
  const bucket = env.PHOTO_BUCKET_CA?.trim();
  return bucket && /^[a-z0-9.-]{3,63}$/.test(bucket)
    ? [`https://${bucket}.s3.ca-central-1.amazonaws.com`]
    : [];
}

export function shopContentSecurityPolicy(
  nonce: string,
  options: { dev?: boolean; imageSources?: string[] } = {},
): string {
  const images = options.imageSources ?? shopImageSources();
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${options.dev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    ["img-src 'self' blob: data:", ...images].join(" "),
    "font-src 'self'",
    "connect-src 'self'",
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
