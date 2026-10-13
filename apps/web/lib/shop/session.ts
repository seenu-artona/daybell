import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { type DataRegion, regionDatabase } from "@daybell/config";
import { formatShopCookie, parseShopCookie, SHOP_SESSION_DAYS } from "@daybell/core";

/**
 * The parent shop's session cookie (ADR 0022; Seenu's answer 3): `daybell_shop=<region>.<token>`, httpOnly, Secure in
 * production, SameSite=Lax, for 30 days from the first code. The token is 32 random bytes; the regional database keeps
 * only its SHA-256, so a database leak can't be replayed as a cookie. The region tells later requests which database
 * holds the session (D113). Parents never sign in: this cookie is all there is.
 */
export const SHOP_COOKIE = "daybell_shop";

export const SHOP_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: SHOP_SESSION_DAYS * 24 * 60 * 60,
};

/** Reads one cookie from a request's Cookie header. */
export function requestCookie(request: Request, name: string): string | undefined {
  for (const part of (request.headers.get("cookie") ?? "").split(";")) {
    const at = part.indexOf("=");
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return undefined;
}

/** SHA-256 of a session token, as the database keeps it. */
export function tokenHash(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/** A new session token: 32 random bytes, base64url (43 characters). */
export function newShopToken(): string {
  return randomBytes(32).toString("base64url");
}

export interface ShopCookieSession {
  region: DataRegion;
  token: string;
  hash: string;
}

/** The session the request's cookie names, if it is well formed and its region is set up here; null otherwise. */
export function shopCookieSession(request: Request): ShopCookieSession | null {
  const parsed = parseShopCookie(requestCookie(request, SHOP_COOKIE));
  if (!parsed || !regionDatabase(parsed.region)) return null;
  return { ...parsed, hash: tokenHash(parsed.token) };
}

export function shopCookieValue(region: DataRegion, token: string): string {
  return formatShopCookie(region, token);
}
