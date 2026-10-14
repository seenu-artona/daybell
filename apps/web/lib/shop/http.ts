import "server-only";
import { ApiError, fromDatabaseError, SHOP_CONFLICTS } from "@daybell/api";
import { availableRegions, type DataRegion } from "@daybell/config";
import { SHOP_REQUESTS_PER_MINUTE, SHOP_WIDE_REQUESTS_PER_MINUTE } from "@daybell/core";
import { NextResponse } from "next/server";
import { handle } from "../api";
import { assertFunctionRegion } from "../region-guard";
import { type ShopRpc, shopRpc } from "../supabase/service";
import {
  SHOP_COOKIE,
  SHOP_COOKIE_MAX_AGE,
  type ShopCookieSession,
  shopCookieName,
  shopCookieOptions,
  shopCookieSessions,
  shopCookieValue,
} from "./session";
import { budgetKeys, DEVICE_COOKIE, deviceCookieOptions } from "./throttle";

/**
 * The parent shop's HTTP plumbing (ADR 0022). Every /api/v1/shop route goes through shopHandle: same-origin writes
 * (handle), answers never cached, refusals as one error shape with Retry-After where it applies. Every request is
 * counted against its network's budget before anything else (security review L7). Nothing here logs a code, a name,
 * an address or a token.
 */

/** A refusal that says when to try again (Retry-After, in seconds). */
export class RetryLater extends ApiError {
  constructor(
    readonly seconds: number,
    message: string,
    fields?: Record<string, string>,
  ) {
    super("rate_limited", message, fields);
  }
}

/** A 409 that will pass by itself, with Retry-After (a paid download still being made, ADR 0023). */
export class ConflictLater extends ApiError {
  constructor(
    readonly seconds: number,
    message: string,
    fields?: Record<string, string>,
  ) {
    super("conflict", message, fields);
  }
}

export const NO_STORE = { "cache-control": "no-store" };

export function shopErrorResponse(err: ApiError): NextResponse {
  return NextResponse.json(err.toBody(), {
    status: err.status,
    headers: {
      ...NO_STORE,
      ...(err instanceof RetryLater || err instanceof ConflictLater
        ? { "retry-after": String(err.seconds) }
        : {}),
    },
  });
}

/** handle() for shop routes: never cached, and refusals carry Retry-After when they have one. */
export function shopHandle<A extends unknown[]>(fn: (...args: A) => Promise<Response>) {
  return handle(async (...args: A) => {
    try {
      const res = await fn(...args);
      res.headers.set("cache-control", "no-store");
      return res;
    } catch (err) {
      if (err instanceof ApiError) return shopErrorResponse(err);
      throw err;
    }
  });
}

export const sessionRequired = () =>
  new ApiError("shop_session_required", "Enter your access code to see your photos.");

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

/** The shop functions' named refusals (their messages carry no values), as API errors. */
const NAMED: Record<string, () => ApiError> = {
  session_required: sessionRequired,
  shop_closed: () => conflict("This shop is closed.", SHOP_CONFLICTS.closed),
  sibling_limit: () => conflict("You can add up to 5 children.", SHOP_CONFLICTS.siblingLimit),
  item_unavailable: () =>
    conflict("That isn't for sale here any more.", SHOP_CONFLICTS.itemUnavailable),
  photo_unavailable: () => conflict("That photo can't be chosen.", SHOP_CONFLICTS.photoUnavailable),
  school_delivery_off: () =>
    conflict(
      "Delivery to school isn't offered for everything in the bag.",
      SHOP_CONFLICTS.schoolDeliveryOff,
    ),
  bag_full: () => conflict("The bag is full.", SHOP_CONFLICTS.bagFull),
  // Checkout (ADR 0023).
  bag_empty: () => conflict("The bag is empty.", SHOP_CONFLICTS.bagEmpty),
  line_unavailable: () =>
    conflict("Something in the bag can't be bought any more.", SHOP_CONFLICTS.lineUnavailable),
  choose_delivery: () => conflict("Choose delivery first.", SHOP_CONFLICTS.chooseDelivery),
  not_accepting: () =>
    conflict("This studio can't take payments right now.", SHOP_CONFLICTS.notAccepting),
  below_minimum: () => conflict("The bag is below the minimum order.", SHOP_CONFLICTS.belowMinimum),
  checkout_limit: () =>
    new RetryLater(600, "Too many checkouts. Wait a few minutes and try again."),
  // Orders (ADR 0024).
  cannot_cancel: () => conflict("This order can't be cancelled here.", SHOP_CONFLICTS.cannotCancel),
  cancel_limit: () =>
    new RetryLater(3600, "Too many cancellations. Try again later.", {
      form: SHOP_CONFLICTS.cancelLimit,
    }),
  fees_pending: () =>
    new ConflictLater(30, "This order is still being confirmed. Try again in a moment."),
  zip_limit: () => new RetryLater(600, "Too many downloads. Wait a few minutes and try again."),
};

type DbError = { code?: string; message?: string } | null;

export function shopError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  if (error.code === "P0002") return new ApiError("not_found", "We couldn't find that.");
  if (error.code === "22023") return new ApiError("invalid_input", "Please check what you sent.");
  return fromDatabaseError(error);
}

/**
 * Runs one of the shop's database functions and returns its data, or throws the matching API error. Every call is
 * first checked against the region's function region (D113; security review R5): Canadian data only from Montréal,
 * whichever session or code named the region.
 */
export async function callShopFunction<T>(
  region: DataRegion,
  fn: ShopRpc,
  args: Record<string, unknown>,
): Promise<T> {
  assertFunctionRegion(region);
  const { data, error } = await shopRpc(region, fn, args);
  if (error) throw shopError(error);
  return data as T;
}

/** The first region with a database: where a request without a usable cookie or code is counted. */
export function fallbackRegion(): DataRegion {
  const region = availableRegions()[0]?.region;
  if (!region) throw new ApiError("region_unavailable", "That region isn't available yet.");
  return region;
}

/**
 * Every shop request, first: in its region's function region (Canadian data in Montréal, D113), and at most 120 a
 * minute per network (Claude's call) and 1,200 per IPv4 /24 or IPv6 /48 (R4), counted in that region's database (the
 * device's first session's, else the first region's).
 */
export async function admitShopRequest(
  request: Request,
  sessions: readonly ShopCookieSession[] = shopCookieSessions(request),
): Promise<void> {
  const region = sessions[0]?.region ?? fallbackRegion();
  const keys = budgetKeys(request);
  const ok = await callShopFunction<boolean>(region, "take_shop_request", {
    p_ip_key: keys.networkKey,
    p_limit: SHOP_REQUESTS_PER_MINUTE,
    p_wide_key: keys.wideKey,
    p_wide_limit: SHOP_WIDE_REQUESTS_PER_MINUTE,
  });
  if (!ok) throw new RetryLater(60, "Too many requests. Wait a minute and try again.");
}

/** The gallery a request names (`?gallery=`), else the device's first. */
export function chosenSession(
  request: Request,
  sessions: readonly ShopCookieSession[],
): ShopCookieSession | null {
  const wanted = new URL(request.url).searchParams.get("gallery");
  if (wanted === null) return sessions[0] ?? null;
  return sessions.find((s) => s.galleryId === wanted) ?? null;
}

/**
 * A request that needs a session: admitted first, then the gallery it names (S6) and its token's hash; 401 without a
 * usable cookie or for a gallery not on this device.
 */
export async function requireShopSession(request: Request): Promise<ShopCookieSession> {
  const sessions = shopCookieSessions(request);
  await admitShopRequest(request, sessions);
  const session = chosenSession(request, sessions);
  if (!session) throw sessionRequired();
  return session;
}

/**
 * Sets the device's sessions (or clears the cookie when none is left), and a new device cookie, or clears the device
 * cookie ("Forget this device", every gallery; R7).
 */
export function setShopCookies(
  request: Request,
  res: NextResponse,
  cookies: {
    sessions?: readonly ShopCookieSession[];
    device?: string | null;
    clearDevice?: boolean;
  },
): NextResponse {
  const name = shopCookieName(request, SHOP_COOKIE);
  if (cookies.sessions && cookies.sessions.length === 0)
    res.cookies.set(name, "", shopCookieOptions(request, 0));
  else if (cookies.sessions)
    res.cookies.set(
      name,
      shopCookieValue(cookies.sessions),
      shopCookieOptions(request, SHOP_COOKIE_MAX_AGE),
    );
  if (cookies.clearDevice)
    res.cookies.set(shopCookieName(request, DEVICE_COOKIE), "", shopCookieOptions(request, 0));
  else if (cookies.device)
    res.cookies.set(
      shopCookieName(request, DEVICE_COOKIE),
      cookies.device,
      deviceCookieOptions(request),
    );
  return res;
}
