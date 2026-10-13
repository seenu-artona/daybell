import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ApiError } from "@daybell/api";
import { shopThrottleKey, shopTrustForwardedFor } from "@daybell/config/server";
import { SHOP_DEVICE_DAYS } from "@daybell/core";
import { requestCookie, shopCookieName, shopCookieOptions } from "./session";

/**
 * What the parent shop counts wrong codes and requests by (Seenu's answer 2; call 4; security review H1, L4, L6; ADR
 * 0022 §2):
 * - the device: a random id the server issues in a signed cookie (HMAC under SHOP_THROTTLE_KEY), valid 30 days. Only a
 *   cookie the server signed counts as a device; anything else is "no device", and every such request on a network
 *   shares one bucket, so dropping or forging the cookie never earns fresh tries.
 * - the network: the client's address (IPv6 by its /64), and the wider networks around it (IPv4 /24; IPv6 /56 and /48).
 * Every one is an HMAC under SHOP_THROTTLE_KEY before it leaves this file: no address or device id is ever stored or
 * logged.
 */
export const DEVICE_COOKIE = "daybell_device";
const DEVICE_SECONDS = SHOP_DEVICE_DAYS * 24 * 60 * 60;

let key: Uint8Array | null = null;

function throttleKey(): Uint8Array {
  if (!key) {
    try {
      key = shopThrottleKey();
    } catch {
      // The variable's name only, never a value.
      console.error("shop_throttle_key_missing");
      throw new ApiError("internal", "Something went wrong on our side. Please try again.");
    }
  }
  return key;
}

const mac = (text: string) =>
  createHmac("sha256", throttleKey()).update(`daybell:shop:v1:${text}`, "utf8").digest();
const macHex = (text: string) => mac(text).toString("hex");

// ── Devices ───────────────────────────────────────────────────────────────────────────────────────────────────────

const DEVICE_VALUE = /^([A-Za-z0-9_-]{43})\.(\d{1,12})\.([A-Za-z0-9_-]{43})$/;

const deviceSignature = (id: string, issuedAt: number) =>
  mac(`device-cookie:${id}.${issuedAt}`).toString("base64url");

/** A device cookie's value: `<id>.<issued at, seconds>.<signature>`. */
export function signDevice(id: string, issuedAt: number): string {
  return `${id}.${issuedAt}.${deviceSignature(id, issuedAt)}`;
}

/** The device id in a cookie value if this server signed it in the last 30 days; null otherwise. */
export function verifiedDevice(value: string | undefined, nowSeconds: number): string | null {
  const match = DEVICE_VALUE.exec(value ?? "");
  if (!match) return null;
  const [, id, issued, signature] = match as unknown as [string, string, string, string];
  const issuedAt = Number(issued);
  if (issuedAt > nowSeconds + 60 || nowSeconds - issuedAt >= DEVICE_SECONDS) return null;
  const expected = Buffer.from(deviceSignature(id, issuedAt));
  const given = Buffer.from(signature);
  return expected.length === given.length && timingSafeEqual(expected, given) ? id : null;
}

// ── Networks ──────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The address a request came from, or null when it can't be trusted (security review L4, R6). On Vercel only
 * `x-vercel-forwarded-for`, which Vercel sets itself (a CDN in front of Vercel would make it the CDN's address; ADR
 * 0022 §2); a request without it shares one strict bucket. Off Vercel, the local server's `x-forwarded-for` only with
 * SHOP_TRUST_XFF=1 (development, CI and end-to-end runs); otherwise every request shares the strict bucket.
 */
export function clientAddress(request: Request): string | null {
  const first = (name: string) => request.headers.get(name)?.split(",")[0]?.trim() || null;
  if (process.env.VERCEL) return first("x-vercel-forwarded-for");
  if (!shopTrustForwardedFor()) return null;
  return first("x-forwarded-for") ?? first("x-real-ip");
}

export interface Networks {
  /** IPv4 address; IPv6 /64. */
  net: string;
  /** IPv4 /24; IPv6 /56. */
  wide: string;
  /** IPv6 /48; null for IPv4. */
  wider: string | null;
}

/** Everything that can't be trusted or read shares one strict bucket. */
const UNTRUSTED: Networks = { net: "untrusted", wide: "untrusted", wider: null };

/** An address's networks (IPv4-mapped IPv6 as IPv4), or the one strict bucket. */
export function networksOf(address: string | null): Networks {
  if (!address) return UNTRUSTED;
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  const v4 = /^(?:::ffff:)?((\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3}))$/.exec(value);
  if (v4) {
    const octets = v4.slice(2, 6).map(Number);
    if (octets.some((o) => o > 255)) return UNTRUSTED;
    return { net: octets.join("."), wide: `${octets.slice(0, 3).join(".")}.0/24`, wider: null };
  }
  const halves = value.split("::");
  if (!value.includes(":") || halves.length > 2) return UNTRUSTED;
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail = halves.length === 2 && halves[1] ? (halves[1] as string).split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return UNTRUSTED;
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return UNTRUSTED;
  const full = groups.map((g) => g.padStart(4, "0"));
  const prefix = (groups: number, extra = "") => `${full.slice(0, groups).join(":")}${extra}`;
  return {
    net: `${prefix(4)}::/64`,
    // The /56 is the first 3½ groups: the 4th group's top byte.
    wide: `${prefix(3)}:${(full[3] as string).slice(0, 2)}00::/56`,
    wider: `${prefix(3)}::/48`,
  };
}

// ── Keys ──────────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * The request budget's HMACs (120 a minute per network; R4: 1,200 per IPv4 /24 or IPv6 /48, so rotating addresses
 * inside one doesn't escape it).
 */
export function budgetKeys(request: Request): { networkKey: string; wideKey: string } {
  const networks = networksOf(clientAddress(request));
  return {
    networkKey: macHex(`net:${networks.net}`),
    wideKey: macHex(`budget-wide:${networks.wider ?? networks.wide}`),
  };
}

export interface CodeKeys {
  /** The network (IPv4 address, IPv6 /64). */
  networkKey: string;
  /** IPv4 /24 or IPv6 /56. */
  wideKey: string;
  /** IPv6 /48; null for IPv4. */
  widerKey: string | null;
  /** The device this server issued, if the request carries its signed cookie. */
  deviceKey: string | null;
  /** When it doesn't: a new device to offer (the database decides whether to issue it), and its cookie. */
  offer: { deviceKey: string; cookie: string } | null;
}

/** The HMACs a code entry is counted by, and a device to offer when the request has none. */
export function codeKeys(request: Request, now = Date.now()): CodeKeys {
  const networks = networksOf(clientAddress(request));
  const seconds = Math.floor(now / 1000);
  const device = verifiedDevice(
    requestCookie(request, shopCookieName(request, DEVICE_COOKIE)),
    seconds,
  );
  let offer: CodeKeys["offer"] = null;
  if (!device) {
    const id = randomBytes(32).toString("base64url");
    offer = { deviceKey: macHex(`device:${id}`), cookie: signDevice(id, seconds) };
  }
  return {
    networkKey: macHex(`net:${networks.net}`),
    wideKey: macHex(`wide:${networks.wide}`),
    widerKey: networks.wider ? macHex(`wider:${networks.wider}`) : null,
    deviceKey: device ? macHex(`device:${device}`) : null,
    offer,
  };
}

/** The device this server issued, if the request carries its signed cookie, as its HMAC; null otherwise. */
export function requestDeviceKey(request: Request, now = Date.now()): string | null {
  const device = verifiedDevice(
    requestCookie(request, shopCookieName(request, DEVICE_COOKIE)),
    Math.floor(now / 1000),
  );
  return device ? macHex(`device:${device}`) : null;
}

/** The device cookie's options: like the session's, for 30 days (L6). */
export function deviceCookieOptions(request: Request) {
  return shopCookieOptions(request, DEVICE_SECONDS);
}

/** Only for tests: forget the cached key. */
export function resetThrottleKeyForTests(): void {
  key = null;
}
