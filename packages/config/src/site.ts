/**
 * The public address of this deployment, used in every emailed link (sign-up, reset, invites).
 * Never derived from the request's Host header, which an attacker can forge (host header injection).
 * Order: SITE_URL if set; on Vercel, the production domain or this preview's own address; else local dev.
 */
export function siteUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SITE_URL?.replace(/\/+$/, "");
  if (explicit) return explicit;
  if (env.VERCEL_ENV === "production" && env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  const vercel = env.VERCEL_BRANCH_URL ?? env.VERCEL_URL;
  if (vercel) return `https://${vercel}`;
  return "http://127.0.0.1:3000";
}
