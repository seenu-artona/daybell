import "server-only";
import { ApiError, SHOP_CODE_NOT_FOUND, SHOP_CONFLICTS, SHOP_LOCKED } from "@daybell/api";
import { type DataRegion, regionDatabase } from "@daybell/config";
import { accessCodeRegion, hashAccessCode, normalizeAccessCode } from "@daybell/core";
import { accessCodeCryptoKeys } from "../access-codes";
import { callShopFunction, fallbackRegion, RetryLater } from "./http";
import { newCookieSession, newShopToken, type ShopCookieSession } from "./session";
import type { CodeKeys } from "./throttle";

/**
 * Access codes in the parent shop (D24; answers 1–2; calls 4, 5; ADR 0022 §1–3). A code is in a request body only,
 * never logged, and only ever reaches a database as its HMAC.
 */

/**
 * Where a typed code is looked up, and its HMAC. The HMAC is always computed, whatever was typed (one path for every
 * input); it is sent only when the code's own region has a database here. Anything else (not a code, another region's)
 * is looked up as nothing in the first region, so it gets a wrong code's answer and counts as one.
 */
export async function codeLookup(
  typed: string,
): Promise<{ region: DataRegion; hash: string | null }> {
  const code = normalizeAccessCode(typed);
  const region = code ? accessCodeRegion(code) : null;
  const hash = await hashAccessCode(code ?? "00000000", (await accessCodeCryptoKeys()).hmac);
  if (code && region && regionDatabase(region)) return { region, hash };
  return { region: fallbackRegion(), hash: null };
}

export const codeNotFound = () =>
  new ApiError("not_found", "We couldn't find that code. Check it and try again.", {
    form: SHOP_CODE_NOT_FOUND,
  });

export const locked = (seconds: number) =>
  new RetryLater(seconds, "Too many tries. Wait and try again.", { form: SHOP_LOCKED });

type Outcome =
  | {
      outcome: "opened" | "added" | "already";
      child_id: string;
      session_hash: string;
      live: string[];
    }
  | { outcome: "limit" | "gallery_limit"; live: string[] }
  | { outcome: "not_found"; alert?: boolean }
  | { outcome: "locked"; retry_after: number; alert?: boolean };

export type EnterResult = {
  /** The device's sessions after this code: those still live, and a new one if the code opened it. */
  sessions: ShopCookieSession[];
  /** A device cookie to set (the database issued the offered device). */
  device: string | null;
} & (
  | { ok: true; childId: string; galleryId: string; added: boolean }
  | { ok: false; error: ApiError }
);

/**
 * Enters a code for this device (S6): a studio it already has a gallery of gets the child; another studio's opens a
 * gallery of its own, up to 3. The lockout and every refusal are the database's (shop_enter_code).
 */
export async function enterCode(
  typed: string,
  keys: CodeKeys,
  sessions: readonly ShopCookieSession[],
): Promise<EnterResult> {
  const lookup = await codeLookup(typed);
  const here = sessions.filter((s) => s.region === lookup.region);
  const fresh = newCookieSession(lookup.region, newShopToken());
  const result = await callShopFunction<Outcome & { device_issued?: boolean }>(
    lookup.region,
    "shop_enter_code",
    {
      p_code_hash: lookup.hash,
      p_device_key: keys.deviceKey,
      p_new_device_key: keys.offer?.deviceKey ?? null,
      p_net_key: keys.networkKey,
      p_wide_key: keys.wideKey,
      p_wider_key: keys.widerKey,
      p_session_hashes: here.map((s) => s.hash),
      p_new_session_hash: fresh.hash,
    },
  );
  // A code-free, name-free alert: the region's breaker has just tripped (security review H1).
  if ("alert" in result && result.alert)
    console.warn("shop_lockout_breaker_tripped", lookup.region);
  // Never a device cookie with a lock (security review R1): the database doesn't issue one then either.
  const device =
    result.device_issued && result.outcome !== "locked" && keys.offer ? keys.offer.cookie : null;
  const live = "live" in result ? new Set(result.live) : null;
  const kept = live
    ? sessions.filter((s) => s.region !== lookup.region || live.has(s.hash))
    : [...sessions];
  switch (result.outcome) {
    case "opened":
      return {
        ok: true,
        childId: result.child_id,
        galleryId: fresh.galleryId,
        added: true,
        sessions: [...kept, fresh],
        device,
      };
    case "added":
    case "already": {
      const session = kept.find((s) => s.hash === result.session_hash);
      if (!session)
        throw new ApiError("internal", "Something went wrong on our side. Please try again.");
      return {
        ok: true,
        childId: result.child_id,
        galleryId: session.galleryId,
        added: result.outcome === "added",
        sessions: kept,
        device,
      };
    }
    case "limit":
      return {
        ok: false,
        error: new ApiError("conflict", "You can add up to 5 children.", {
          form: SHOP_CONFLICTS.siblingLimit,
        }),
        sessions: kept,
        device,
      };
    case "gallery_limit":
      return {
        ok: false,
        error: new ApiError("conflict", "This device already has 3 photographers' galleries.", {
          form: SHOP_CONFLICTS.galleryLimit,
        }),
        sessions: kept,
        device,
      };
    case "locked":
      return { ok: false, error: locked(result.retry_after), sessions: kept, device };
    default:
      return { ok: false, error: codeNotFound(), sessions: kept, device };
  }
}
