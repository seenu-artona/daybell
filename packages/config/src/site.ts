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

/**
 * The parent shop's address, printed on QR cards as "Go to …, enter your code" (D138; Seenu, answer 1 to the step 3
 * brief). SHOP_URL if set (the shop's own domain, once it exists); otherwise this deployment's /shop, the one shop
 * address every studio shares (Seenu, answer 1 to the step 9 brief; ADR 0022, amending ADR 0015), so staging prints
 * its Vercel address with /shop. Never hard-coded. A SHOP_URL that isn't an http(s) address is refused (by name, never
 * by value), so a typo can't be printed on thousands of cards.
 */
export function shopUrl(env: Record<string, string | undefined> = process.env): string {
  const explicit = env.SHOP_URL?.trim().replace(/\/+$/, "");
  if (!explicit) return `${siteUrl(env)}/shop`;
  let url: URL;
  try {
    url = new URL(explicit);
  } catch {
    throw new Error("SHOP_URL must be an http(s) address");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error("SHOP_URL must be an http(s) address");
  return explicit;
}
