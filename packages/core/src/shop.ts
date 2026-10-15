/**
 * The parent shop (Phase 1 step 9; D24, D60, D116, D119, F17; Seenu's answers 1–4 and Claude's calls 1–13 of Oct 12,
 * 2026; ADR 0022). A parent types a child's access code and sees the gallery at once (D24); the code opens a session
 * for up to 5 children of one studio, kept 30 days, with a bag priced from each job's current price list. Money is
 * whole cents (D96), before tax.
 *
 * The database enforces the same rules (packages/db migration 20261012700000_parent_shop.sql: shop_enter_code,
 * app.shop_code_failed, shop_cart_add, shop_set_shipping); these are the rules in one readable place, for the API and
 * the screens, and the unit tests that pin them.
 */
import type { AccessCodeRegion } from "./access-codes";
import type { PriceItemKind } from "./price-lists";

/** A session shows the first code's child and up to 4 siblings, of the same studio (call 1). */
export const SHOP_SIBLING_LIMIT = 5;
/** A device holds a session (a gallery and a bag) for each of up to 3 studios (code review S6). */
export const SHOP_GALLERY_LIMIT = 3;
/**
 * At most this many sessions show one child; opening another forgets the oldest with an empty bag (security review M2,
 * R3). A session with something in its bag is never forgotten for this.
 */
export const SHOP_SESSIONS_PER_CHILD = 10;
/** New sessions showing one child in 24 hours; beyond that a right code is refused as locked (security review R3). */
export const SHOP_CHILD_SESSIONS_PER_DAY = 10;
/** Devices newly made "known" by one child's code in 24 hours (security review R3). */
export const SHOP_KNOWN_DEVICES_PER_CHILD_PER_DAY = 3;
/** Fixed from the first code; adding a sibling doesn't extend it (answer 3, call 11). */
export const SHOP_SESSION_DAYS = 30;
/** Wrong codes from one device (or a network's requests without one) before it is locked (answer 2, call 4). */
export const SHOP_LOCK_TRIES = 5;
/** How long a lock lasts (answer 2). */
export const SHOP_LOCK_MINUTES = 15;
/** A device's wrong codes count for this long. */
export const SHOP_DEVICE_WINDOW_HOURS = 24;
/** Wrong codes from one network, from any device, in SHOP_NETWORK_WINDOW_MINUTES before it is locked (call 4). */
export const SHOP_NETWORK_LOCK_TRIES = 30;
export const SHOP_NETWORK_WINDOW_MINUTES = 15;
/** The wider networks' ceilings in the same 15 minutes (security review H1): an IPv4 /24 or IPv6 /56, an IPv6 /48. */
export const SHOP_WIDE_LOCK_TRIES = 100;
export const SHOP_WIDER_LOCK_TRIES = 300;
/** Wrong codes in a minute across a region that trip its circuit breaker for SHOP_LOCK_MINUTES (H1). */
export const SHOP_BREAKER_PER_MINUTE = 600;
/** The breaker's count is spread over this many rows, summed, so wrong codes don't queue on one row (R9). */
export const SHOP_BREAKER_SHARDS = 16;
/**
 * While the breaker is tripped, the ceilings of a network that already had a wrong code in the hour before its current
 * count began are about a third (security review R2); other networks keep theirs.
 */
export const SHOP_TRIPPED_TRIES = { net: 10, wide: 30, wider: 100 } as const;
export const SHOP_TRIPPED_LOOKBACK_HOURS = 1;
/**
 * New devices issued a day: per IPv4 address and /24 (R1: raised, as shared carrier addresses see many parents), and per
 * IPv6 /64, /56 and /48 (H1).
 */
export const SHOP_NEW_DEVICES_PER_DAY = {
  ipv4: { net: 500, wide: 5000 },
  ipv6: { net: 50, wide: 200, wider: 500 },
} as const;
/** The device cookie, and a known device's record, last this long (security review L6). */
export const SHOP_DEVICE_DAYS = 30;
/** A known device keeps its own allowance on a locked network unless it was itself locked this recently (M3). */
export const SHOP_KNOWN_DEVICE_COOLDOWN_HOURS = 24;
/** Shop requests per network per minute (Claude's call, for Seenu to review). */
export const SHOP_REQUESTS_PER_MINUTE = 120;
/** And per IPv4 /24 or IPv6 /48 (security review R4). */
export const SHOP_WIDE_REQUESTS_PER_MINUTE = 1200;
/** Signed preview URLs last 10 minutes (Claude's call, for Seenu to review). */
export const SHOP_PREVIEW_SECONDS = 600;
/** Lines in one bag, and a line's quantity. */
export const SHOP_BAG_LINES = 100;
export const SHOP_MAX_QUANTITY = 99;

const MINUTE = 60_000;

// ── Lockout ───────────────────────────────────────────────────────────────────────────────────────────────────────

/**
 * What is counted per key (security review H1): a device the server issued, wherever it is; the shared bucket of a
 * network's requests without one; the network (IPv4 address, IPv6 /64); its /24 or /56; its IPv6 /48.
 */
export type LockoutKind = "device" | "nodevice" | "net" | "wide" | "wider";

export interface LockoutState {
  failures: number;
  /** When the current count started (ms since the epoch). */
  windowStart: number;
  /** Locked until this moment (ms), or null. */
  lockedUntil: number | null;
  /** The last wrong code (ms). */
  lastAt: number;
  /** The last wrong code before the current count began (ms), or null (security review R2). */
  earlierAt: number | null;
}

const NETWORK_WINDOW_MS = SHOP_NETWORK_WINDOW_MINUTES * MINUTE;
const DEVICE_LIMIT = { tries: SHOP_LOCK_TRIES, windowMs: SHOP_DEVICE_WINDOW_HOURS * 60 * MINUTE };

const NETWORK_TRIES = {
  net: SHOP_NETWORK_LOCK_TRIES,
  wide: SHOP_WIDE_LOCK_TRIES,
  wider: SHOP_WIDER_LOCK_TRIES,
} as const;

/** A key's limit: wrong codes in a window. A tightened network's limit is a third (see lockoutStep). */
export function lockoutLimit(
  kind: LockoutKind,
  tightened = false,
): { tries: number; windowMs: number } {
  if (kind === "device" || kind === "nodevice") return DEVICE_LIMIT;
  return {
    tries: tightened ? SHOP_TRIPPED_TRIES[kind] : NETWORK_TRIES[kind],
    windowMs: NETWORK_WINDOW_MS,
  };
}

export function isLocked(state: LockoutState | null, now: number): boolean {
  return state?.lockedUntil != null && state.lockedUntil > now;
}

/** Seconds until a lock ends, at least 1; 0 when not locked. */
export function retryAfterSeconds(state: LockoutState | null, now: number): number {
  if (!isLocked(state, now) || state?.lockedUntil == null) return 0;
  return Math.max(Math.ceil((state.lockedUntil - now) / 1000), 1);
}

/**
 * One wrong code for a key. A served lock, or (unlocked) a window that has passed, starts the count again, remembering
 * the last wrong code before it; the count that reaches the limit locks the key for 15 minutes. While the region's
 * breaker is tripped, a network whose last wrong code before this count was within the hour is tightened to a third
 * (security review R2): a network that keeps coming back, not every network. A running lock is never extended or
 * cleared (a known device's wrong codes still count on its locked network). A right code never calls this: it never
 * resets the count, so one real code can't clear it between guesses.
 */
export function lockoutStep(
  kind: LockoutKind,
  state: LockoutState | null,
  now: number,
  tripped = false,
): LockoutState {
  const windowMs = lockoutLimit(kind).windowMs;
  let next: LockoutState = state ?? {
    failures: 0,
    windowStart: now,
    lockedUntil: null,
    lastAt: now,
    earlierAt: null,
  };
  if (
    state !== null &&
    ((next.lockedUntil !== null && next.lockedUntil <= now) ||
      (next.lockedUntil === null && next.windowStart + windowMs <= now))
  )
    next = {
      failures: 0,
      windowStart: now,
      lockedUntil: null,
      lastAt: now,
      earlierAt: next.lastAt,
    };
  const tightened =
    tripped &&
    next.earlierAt !== null &&
    next.earlierAt > now - SHOP_TRIPPED_LOOKBACK_HOURS * 60 * MINUTE;
  const { tries } = lockoutLimit(kind, tightened);
  const failures = Math.min(next.failures + 1, 1_000_000);
  return {
    failures,
    windowStart: next.windowStart,
    lockedUntil:
      next.lockedUntil === null && failures >= tries
        ? now + SHOP_LOCK_MINUTES * MINUTE
        : next.lockedUntil,
    lastAt: now,
    earlierAt: next.earlierAt,
  };
}

/**
 * Whether a device keeps its own allowance while its network is locked (security review M3): it has opened a gallery
 * before and hasn't itself been locked in the last 24 hours. It keeps it while the breaker is tripped too (R2), as
 * one child's code makes at most SHOP_KNOWN_DEVICES_PER_CHILD_PER_DAY devices known (R3).
 */
export function keepsOwnAllowance(
  device: { known: boolean; lockedAt: number | null } | null,
  now: number,
): boolean {
  if (!device?.known) return false;
  return (
    device.lockedAt === null ||
    device.lockedAt <= now - SHOP_KNOWN_DEVICE_COOLDOWN_HOURS * 60 * MINUTE
  );
}

// ── Names ─────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Parents see a child's first name and last initial only, e.g. "Ava P." (call 2). */
export function parentDisplayName(firstName: string, lastNameOrInitial: string): string {
  const initial = [...lastNameOrInitial.trim()][0]?.toLocaleUpperCase("en") ?? "";
  return initial ? `${firstName.trim()} ${initial}.` : firstName.trim();
}

// ── The cover ─────────────────────────────────────────────────────────────────────────────────────────────────────

/** The cover shows the child's first visible portrait in tagging order, until studios can star a pose (call 3). */
export function pickCoverPhoto<T>(portraits: readonly T[]): T | null {
  return portraits[0] ?? null;
}

// ── Poses (D156 C5; ADR 0033 N6) ──────────────────────────────────────────────────────────────────────────────────

/** Which of a child's sets a pose comes from: their own portraits, or the group photos of their groups. */
export type PoseSet = "portraits" | "groupPhotos";

export interface Pose<T> {
  photo: T;
  set: PoseSet;
  /** Its place in its set, from 1, and the set's size (for "Group photo 2 of 4"). */
  n: number;
  total: number;
}

/**
 * Every photo a parent may choose as a pose: any product works with a group photo (D157), so the child's portraits
 * come first, then the group photos of the groups they are in (N6), each in tagging order.
 */
export function shopPoses<T>(portraits: readonly T[], groupPhotos: readonly T[]): Pose<T>[] {
  return [
    ...portraits.map((photo, i) => ({
      photo,
      set: "portraits" as const,
      n: i + 1,
      total: portraits.length,
    })),
    ...groupPhotos.map((photo, i) => ({
      photo,
      set: "groupPhotos" as const,
      n: i + 1,
      total: groupPhotos.length,
    })),
  ];
}

/** The pose chosen at first: the one the parent came with (a portrait or a group photo), else the first portrait. */
export function initialPose<T extends { id: string }>(
  portraits: readonly T[],
  groupPhotos: readonly T[],
  wanted: string | null,
): string | null {
  const all = shopPoses(portraits, groupPhotos);
  return all.find((p) => p.photo.id === wanted)?.photo.id ?? all[0]?.photo.id ?? null;
}

// ── The bag ───────────────────────────────────────────────────────────────────────────────────────────────────────

export type ShopShippingMethod = "home" | "school";
export const SHOP_SHIPPING_METHODS = ["home", "school"] as const;

export type CartLineProblem = "needs_pose" | "no_pose" | "digital_once" | "quantity";

/**
 * What a bag line may be: a package, print or single digital needs a pose; "all digitals" has none; digital downloads
 * are bought once; quantities are 1 to 99. Null when the line is fine.
 */
export function cartLineProblem(
  kind: PriceItemKind,
  hasPose: boolean,
  quantity: number,
): CartLineProblem | null {
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > SHOP_MAX_QUANTITY)
    return "quantity";
  if (kind === "digital_all" && hasPose) return "no_pose";
  if (kind !== "digital_all" && !hasPose) return "needs_pose";
  if ((kind === "digital_single" || kind === "digital_all") && quantity !== 1)
    return "digital_once";
  return null;
}

/** Whether a line's quantity can change: never for digital downloads. */
export function hasQuantity(kind: PriceItemKind): boolean {
  return kind === "package" || kind === "print";
}

/** The same item and pose added again: one line, its quantities added (at most 99); a download stays 1. */
export function mergeQuantity(kind: PriceItemKind, existing: number, added: number): number {
  return hasQuantity(kind) ? Math.min(existing + added, SHOP_MAX_QUANTITY) : 1;
}

export interface CartLineFacts {
  jobId: string;
  priceCents: number;
  quantity: number;
  /** Can still be bought: on the job's current list, the shop open, the pose still visible. */
  available: boolean;
  /** Needs delivery: a print, or a package holding prints. */
  physical: boolean;
}

export interface CartJobFacts {
  jobId: string;
  homeShippingCents: number;
  deliverToSchool: boolean;
}

export interface ShippingOptions {
  /** Something in the bag needs delivery. */
  needed: boolean;
  /** The home fee: the highest of the bag's jobs with something to deliver (call 9). */
  homeCents: number;
  /** Free delivery to school, offered only when every such job allows it (call 9). */
  school: boolean;
}

/** Delivery for a bag (call 9): one home fee per bag, the highest; school only if every job delivers there. */
export function availableShipping(
  lines: readonly CartLineFacts[],
  jobs: readonly CartJobFacts[],
): ShippingOptions {
  const ids = new Set(lines.filter((l) => l.available && l.physical).map((l) => l.jobId));
  const shipping = jobs.filter((j) => ids.has(j.jobId));
  if (ids.size === 0) return { needed: false, homeCents: 0, school: false };
  // Money fails closed (code review N3): a job missing here would make delivery free.
  if (shipping.length !== ids.size)
    throw new Error("Every job with something to deliver needs its delivery facts");
  return {
    needed: true,
    homeCents: Math.max(...shipping.map((j) => j.homeShippingCents)),
    school: shipping.every((j) => j.deliverToSchool),
  };
}

/**
 * The delivery that applies: none when nothing needs it; home when it is the only choice; else what the parent chose,
 * if it is still offered (null: they must choose).
 */
export function effectiveShipping(
  chosen: ShopShippingMethod | null,
  options: ShippingOptions,
): ShopShippingMethod | null {
  if (!options.needed) return null;
  if (!options.school) return "home";
  return chosen;
}

export interface CartTotals {
  /** Things in the bag that can be bought (quantities added). */
  count: number;
  subtotalCents: number;
  shipping: ShippingOptions & { method: ShopShippingMethod | null; cents: number | null };
  /** Subtotal plus delivery, before tax. Null while delivery is still to be chosen. */
  totalCents: number | null;
}

/**
 * The bag's totals in whole cents, before tax (D96): unavailable lines don't count; school delivery and a bag with
 * nothing to deliver cost nothing (ADR 0019 call 6).
 */
export function cartTotals(
  lines: readonly CartLineFacts[],
  jobs: readonly CartJobFacts[],
  chosen: ShopShippingMethod | null,
): CartTotals {
  const counted = lines.filter((l) => l.available);
  const subtotalCents = counted.reduce((sum, l) => sum + l.priceCents * l.quantity, 0);
  const options = availableShipping(lines, jobs);
  const method = effectiveShipping(chosen, options);
  const cents = !options.needed
    ? 0
    : method === null
      ? null
      : method === "home"
        ? options.homeCents
        : 0;
  if (!Number.isSafeInteger(subtotalCents))
    throw new Error("Money must be a whole number of cents");
  return {
    count: counted.reduce((n, l) => n + l.quantity, 0),
    subtotalCents,
    shipping: { ...options, method, cents },
    totalCents: cents === null ? null : subtotalCents + cents,
  };
}

// ── The session cookie ────────────────────────────────────────────────────────────────────────────────────────────

/** The session's token: 32 random bytes, base64url without padding (43 characters). */
const TOKEN = /^[A-Za-z0-9_-]{43}$/;

/** "ca.<token>": the cookie names its regional database (D113), so later requests go straight there. */
export function formatShopCookie(region: AccessCodeRegion, token: string): string {
  if (!TOKEN.test(token)) throw new Error("A shop token is 43 base64url characters");
  return `${region}.${token}`;
}

/** The region and token in a shop cookie entry, or null for anything else (then there is no session). */
export function parseShopCookie(
  value: string | null | undefined,
): { region: AccessCodeRegion; token: string } | null {
  const match = /^(us|ca)\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) return null;
  return { region: match[1] as AccessCodeRegion, token: match[2] as string };
}

/** Separates a device's sessions in the one shop cookie (a cookie-safe character no entry contains). */
const SESSIONS_SEPARATOR = "~";

/**
 * A device's sessions, one per studio (S6): "ca.<token>~ca.<token>", at most 3, oldest first. Malformed entries and
 * repeats are dropped, and only the first 3 well-formed ones count.
 */
export function parseShopCookies(
  value: string | null | undefined,
): { region: AccessCodeRegion; token: string }[] {
  const out: { region: AccessCodeRegion; token: string }[] = [];
  for (const part of (value ?? "").split(SESSIONS_SEPARATOR)) {
    const entry = parseShopCookie(part);
    if (entry && !out.some((e) => e.token === entry.token)) out.push(entry);
    if (out.length === SHOP_GALLERY_LIMIT) break;
  }
  return out;
}

/** The cookie's value for a device's sessions (at most 3). */
export function formatShopCookies(
  entries: readonly { region: AccessCodeRegion; token: string }[],
): string {
  if (entries.length > SHOP_GALLERY_LIMIT)
    throw new Error("A device holds at most 3 shop sessions");
  return entries.map((e) => formatShopCookie(e.region, e.token)).join(SESSIONS_SEPARATOR);
}
