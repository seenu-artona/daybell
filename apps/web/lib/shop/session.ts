import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { type DataRegion, regionDatabase } from "@daybell/config";
import { formatShopCookies, parseShopCookies, SHOP_SESSION_DAYS } from "@daybell/core";

/**
 * The parent shop's session cookie (ADR 0022; Seenu's answer 3; code review S6): one cookie holding a session for each
 * of up to 3 studios, `<region>.<token>~<region>.<token>`, httpOnly, SameSite=Lax, 30 days. Each token is 32 random
 * bytes; the regional database keeps only its SHA-256, so a database leak can't be replayed as a cookie. The region
 * tells later requests which database holds the session (D113). Parents never sign in: this cookie is all there is.
 *
 * Over HTTPS the cookies are `__Host-` prefixed, Secure, Path=/ and without a Domain (security review L1): a sibling
 * subdomain can't plant one. Only on http://localhost (development and the end-to-end runs) are they plain and not
 * Secure, as browsers refuse Secure cookies over plain HTTP; there a plain name is the only one read.
 */
export const SHOP_COOKIE = "daybell_shop";

/** http://localhost, 127.0.0.1 or [::1]: the only place cookies aren't Secure and `__Host-` prefixed. */
export function isLocalRequest(request: Request): boolean {
  const { protocol, hostname } = new URL(request.url);
  return (
    protocol === "http:" &&
    (hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]")
  );
}

/** A shop cookie's name for this request: `__Host-<name>` except on http://localhost. */
export function shopCookieName(request: Request, name: string): string {
  return isLocalRequest(request) ? name : `__Host-${name}`;
}

/** httpOnly, SameSite=Lax, Path=/, no Domain; Secure except on http://localhost. */
export function shopCookieOptions(request: Request, maxAgeSeconds: number) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: !isLocalRequest(request),
    path: "/",
    maxAge: maxAgeSeconds,
  };
}

export const SHOP_COOKIE_MAX_AGE = SHOP_SESSION_DAYS * 24 * 60 * 60;

/** Reads one cookie from a request's Cookie header (the first with that exact name). */
export function requestCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) {
      const value = part.slice(at + 1).trim();
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }
  return undefined;
}

/** SHA-256 of a session token, as the database keeps it. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * A gallery's id on this device: a one-way hash of its token, so the screens can name a gallery in a URL without
 * holding the token (which stays in the httpOnly cookie). Not a credential.
 */
export function galleryId(token: string): string {
  return createHash("sha256")
    .update(`daybell:shop:gallery:v1:${token}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

/** A new session token: 32 random bytes, base64url (43 characters). */
export function newShopToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface ShopCookieSession {
  region: DataRegion;
  token: string;
  hash: string;
  galleryId: string;
}

const toSession = (e: { region: DataRegion; token: string }): ShopCookieSession => ({
  ...e,
  hash: tokenHash(e.token),
  galleryId: galleryId(e.token),
});

/** The request's sessions (at most 3, oldest first): well formed, of a region set up here. */
export function shopCookieSessions(request: Request): ShopCookieSession[] {
  return parseShopCookies(requestCookie(request, shopCookieName(request, SHOP_COOKIE)))
    .filter((e) => regionDatabase(e.region))
    .map(toSession);
}

/** A session for a new token. */
export function newCookieSession(region: DataRegion, token: string): ShopCookieSession {
  return toSession({ region, token });
}

/** The cookie's value for these sessions. */
export function shopCookieValue(sessions: readonly ShopCookieSession[]): string {
  return formatShopCookies(sessions.map(({ region, token }) => ({ region, token })));
}
