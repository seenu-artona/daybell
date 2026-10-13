import "server-only";
import { createHmac, randomBytes } from "node:crypto";
import { ApiError } from "@daybell/api";
import { shopThrottleKey } from "@daybell/config/server";
import { requestCookie } from "./session";

/**
 * What the parent shop counts wrong codes and requests by (Seenu's answer 2; call 4; ADR 0022): the network (the
 * client's address; IPv6 by its /64, which one household or phone usually holds) and the device (a random cookie). Both
 * are HMACs under SHOP_THROTTLE_KEY before they leave this file: no address or device id is ever stored or logged.
 *
 * The address is the first x-forwarded-for entry, which Vercel sets itself and overwrites (a client can't forge it
 * there). Off Vercel (local and CI) every request may share one network, which only makes the limits stricter.
 */
export const DEVICE_COOKIE = "daybell_device";

export const DEVICE_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax" as const,
  secure: process.env.NODE_ENV === "production",
  path: "/",
  // Used for the lockout only; a person clearing it just counts against their network instead.
  maxAge: 400 * 24 * 60 * 60,
};

const DEVICE = /^[A-Za-z0-9_-]{43}$/;

/** The address a request came from, or "unknown". */
export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || request.headers.get("x-real-ip")?.trim() || "unknown";
}

/** An address's network: IPv4 as it is; IPv6 its /64 ("2001:0db8:0001:0002::/64"); anything else "unknown". */
export function networkOf(address: string): string {
  const value = address
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/%.*$/, "");
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(value);
  if (mapped) return mapped[1] as string;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(value)) return value;
  const halves = value.split("::");
  if (!value.includes(":") || halves.length > 2) return "unknown";
  const head = halves[0] ? (halves[0] as string).split(":") : [];
  const tail = halves.length === 2 && halves[1] ? (halves[1] as string).split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? head.length !== 8 : missing < 1) return "unknown";
  const groups = [...head, ...Array<string>(halves.length === 2 ? missing : 0).fill("0"), ...tail];
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/.test(g))) return "unknown";
  return `${groups
    .slice(0, 4)
    .map((g) => g.padStart(4, "0"))
    .join(":")}::/64`;
}

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
  createHmac("sha256", throttleKey()).update(`daybell:shop:v1:${text}`, "utf8").digest("hex");

export interface ShopKeys {
  /** The network. */
  ip: string;
  /** The network and the device together. */
  pair: string;
  /** A device cookie to set, when the request had none. */
  newDevice: string | null;
}

/** The request's HMAC keys, and a new device cookie when it had none (or a malformed one). */
export function shopKeys(request: Request): ShopKeys {
  const network = networkOf(clientAddress(request));
  const existing = requestCookie(request, DEVICE_COOKIE);
  const device = existing && DEVICE.test(existing) ? existing : null;
  const newDevice = device ? null : randomBytes(32).toString("base64url");
  return {
    ip: mac(`ip:${network}`),
    pair: mac(`pair:${network}:${device ?? newDevice}`),
    newDevice,
  };
}

/** Only for tests: forget the cached key. */
export function resetThrottleKeyForTests(): void {
  key = null;
}
