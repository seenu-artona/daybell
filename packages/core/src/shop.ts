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
/** Fixed from the first code; adding a sibling doesn't extend it (answer 3, call 11). */
export const SHOP_SESSION_DAYS = 30;
/** Wrong codes from one network and device before it is locked (answer 2, call 4). */
export const SHOP_LOCK_TRIES = 5;
/** How long a lock lasts (answer 2). */
export const SHOP_LOCK_MINUTES = 15;
/** A device's wrong codes count for this long. */
export const SHOP_DEVICE_WINDOW_HOURS = 24;
/** Wrong codes from one network, from any device, in SHOP_NETWORK_WINDOW_MINUTES before it is locked (call 4). */
export const SHOP_NETWORK_LOCK_TRIES = 30;
export const SHOP_NETWORK_WINDOW_MINUTES = 15;
/** Shop requests per network per minute (Claude's call, for Seenu to review). */
export const SHOP_REQUESTS_PER_MINUTE = 120;
/** Signed preview URLs last 10 minutes (Claude's call, for Seenu to review). */
export const SHOP_PREVIEW_SECONDS = 600;
/** Lines in one bag, and a line's quantity. */
export const SHOP_BAG_LINES = 100;
export const SHOP_MAX_QUANTITY = 99;

const MINUTE = 60_000;

// ── Lockout ───────────────────────────────────────────────────────────────────────────────────────────────────────

/** What is counted per key: a network and device together ("pair"), or a network ("ip"). */
export type LockoutKind = "pair" | "ip";

export interface LockoutState {
  failures: number;
  /** When the current count started (ms since the epoch). */
  windowStart: number;
  /** Locked until this moment (ms), or null. */
  lockedUntil: number | null;
}

const LIMITS: Record<LockoutKind, { tries: number; windowMs: number }> = {
  pair: { tries: SHOP_LOCK_TRIES, windowMs: SHOP_DEVICE_WINDOW_HOURS * 60 * MINUTE },
  ip: { tries: SHOP_NETWORK_LOCK_TRIES, windowMs: SHOP_NETWORK_WINDOW_MINUTES * MINUTE },
};

export function isLocked(state: LockoutState | null, now: number): boolean {
  return state?.lockedUntil != null && state.lockedUntil > now;
}

/** Seconds until a lock ends, at least 1; 0 when not locked. */
export function retryAfterSeconds(state: LockoutState | null, now: number): number {
  if (!isLocked(state, now) || state?.lockedUntil == null) return 0;
  return Math.max(Math.ceil((state.lockedUntil - now) / 1000), 1);
}

/**
 * One wrong code for a key. A served lock, or a window that has passed, starts the count again; the count that reaches
 * the limit locks the key for 15 minutes. A right code never calls this: it never resets the count, so one real code
 * can't clear it between guesses.
 */
export function lockoutStep(
  kind: LockoutKind,
  state: LockoutState | null,
  now: number,
): LockoutState {
  const { tries, windowMs } = LIMITS[kind];
  let next: LockoutState = state ?? { failures: 0, windowStart: now, lockedUntil: null };
  if ((next.lockedUntil !== null && next.lockedUntil <= now) || next.windowStart + windowMs <= now)
    next = { failures: 0, windowStart: now, lockedUntil: null };
  const failures = next.failures + 1;
  return {
    failures,
    windowStart: next.windowStart,
    lockedUntil: failures >= tries ? now + SHOP_LOCK_MINUTES * MINUTE : next.lockedUntil,
  };
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
  if (ids.size === 0 || shipping.length !== ids.size)
    return { needed: ids.size > 0, homeCents: 0, school: false };
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

/** The region and token in a shop cookie, or null for anything else (then there is no session). */
export function parseShopCookie(
  value: string | null | undefined,
): { region: AccessCodeRegion; token: string } | null {
  const match = /^(us|ca)\.([A-Za-z0-9_-]{43})$/.exec(value ?? "");
  if (!match) return null;
  return { region: match[1] as AccessCodeRegion, token: match[2] as string };
}
