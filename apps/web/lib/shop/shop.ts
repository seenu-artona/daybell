import "server-only";
import {
  ApiError,
  fromDatabaseError,
  SHOP_CODE_NOT_FOUND,
  SHOP_CONFLICTS,
  SHOP_LOCKED,
  type ShopCartResponse,
  type ShopChild,
  type ShopChildState,
  type ShopGalleryResponse,
  type ShopItem,
  type ShopPhoto,
  type ShopPriceListResponse,
  type ShopSessionResponse,
} from "@daybell/api";
import { availableRegions, type DataRegion, regionDatabase } from "@daybell/config";
import {
  accessCodeRegion,
  type Currency,
  cartTotals,
  hashAccessCode,
  normalizeAccessCode,
  type PackageLineKind,
  type PriceItemKind,
  type PrintSize,
  parentDisplayName,
  photoKey,
  pickCoverPhoto,
  SHOP_PREVIEW_SECONDS,
  SHOP_REQUESTS_PER_MINUTE,
  type ShopShippingMethod,
} from "@daybell/core";
import type { PhotoStorage } from "@daybell/storage";
import { NextResponse } from "next/server";
import { accessCodeCryptoKeys } from "../access-codes";
import { handle } from "../api";
import { photoStorage } from "../photo-storage";
import { assertFunctionRegion, assertStorageRegion } from "../region-guard";
import { type ShopRpc, shopRpc } from "../supabase/service";
import {
  SHOP_COOKIE,
  SHOP_COOKIE_OPTIONS,
  type ShopCookieSession,
  shopCookieSession,
} from "./session";
import { DEVICE_COOKIE, DEVICE_COOKIE_OPTIONS, type ShopKeys, shopKeys } from "./throttle";

/**
 * The parent shop's server side (ADR 0022). Every /api/v1/shop route goes through shopHandle: same-origin writes
 * (handle), answers never cached, refusals as one error shape with Retry-After where it applies. Nothing here logs a
 * code, a name, an address or a token.
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

export const NO_STORE = { "cache-control": "no-store" };

export function shopErrorResponse(err: ApiError): NextResponse {
  return NextResponse.json(err.toBody(), {
    status: err.status,
    headers: {
      ...NO_STORE,
      ...(err instanceof RetryLater ? { "retry-after": String(err.seconds) } : {}),
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
};

type DbError = { code?: string; message?: string } | null;

export function shopError(error: NonNullable<DbError>): ApiError {
  const named = error.code === "P0001" && error.message ? NAMED[error.message] : undefined;
  if (named) return named();
  if (error.code === "P0002") return new ApiError("not_found", "We couldn't find that.");
  if (error.code === "22023") return new ApiError("invalid_input", "Please check what you sent.");
  return fromDatabaseError(error);
}

/** Runs a shop function and returns its data, or throws the matching API error. */
export async function shop<T>(
  region: DataRegion,
  fn: ShopRpc,
  args: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await shopRpc(region, fn, args);
  if (error) throw shopError(error);
  return data as T;
}

/** The first region with a database: where a request without a usable cookie or code is counted. */
function fallbackRegion(): DataRegion {
  const region = availableRegions()[0]?.region;
  if (!region) throw new ApiError("region_unavailable", "That region isn't available yet.");
  return region;
}

/**
 * Every shop request: in its region's function region (Canadian data in Montréal, D113), and at most 120 a minute per
 * network (Claude's call), counted in that region's database.
 */
export async function admitShopRequest(region: DataRegion, keys: ShopKeys): Promise<void> {
  assertFunctionRegion(region);
  const ok = await shop<boolean>(region, "take_shop_request", {
    p_ip_key: keys.ip,
    p_limit: SHOP_REQUESTS_PER_MINUTE,
  });
  if (!ok) throw new RetryLater(60, "Too many requests. Wait a minute and try again.");
}

/** A request that needs a session: its region (admitted) and the token's hash; 401 without a usable cookie. */
export async function requireShopSession(
  request: Request,
): Promise<ShopCookieSession & { keys: ShopKeys }> {
  const session = shopCookieSession(request);
  const keys = shopKeys(request);
  await admitShopRequest(session?.region ?? fallbackRegion(), keys);
  if (!session) throw sessionRequired();
  return { ...session, keys };
}

/** Sets or clears the shop's cookies on a response. */
export function setShopCookies(
  res: NextResponse,
  cookies: { session?: { value: string } | "clear"; device?: string | null },
): NextResponse {
  if (cookies.session === "clear")
    res.cookies.set(SHOP_COOKIE, "", { ...SHOP_COOKIE_OPTIONS, maxAge: 0 });
  else if (cookies.session)
    res.cookies.set(SHOP_COOKIE, cookies.session.value, SHOP_COOKIE_OPTIONS);
  if (cookies.device) res.cookies.set(DEVICE_COOKIE, cookies.device, DEVICE_COOKIE_OPTIONS);
  return res;
}

// ── Codes ─────────────────────────────────────────────────────────────────────────────────────────────────────────

export type EnterOutcome =
  | { outcome: "opened" | "added" | "already"; child_id: string }
  | { outcome: "not_found" | "limit" | "other_studio" }
  | { outcome: "locked"; retry_after: number };

/**
 * Where a typed code is looked up, and its HMAC. The HMAC is always computed, whatever was typed (one path for every
 * input); it is sent only when the code's own region has a database here. Anything else (not a code, another region's)
 * is looked up as nothing in the first region, so it gets a wrong code's answer and counts as one. Never logged.
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

// ── Photos ────────────────────────────────────────────────────────────────────────────────────────────────────────

/** Parents only ever get these: the watermarked, low-resolution previews (D60). Never the original or plain previews. */
export type ParentPreview = "proof-thumb.webp" | "proof.webp";

export function signParentPreview(
  storage: PhotoStorage,
  ids: { studioId: string; jobId: string; photoId: string },
  variant: ParentPreview,
): Promise<string> {
  return storage.presignGet(photoKey(ids, variant), { expiresIn: SHOP_PREVIEW_SECONDS });
}

interface DbPhoto {
  id: string;
  width: number | null;
  height: number | null;
}

async function signPhotos(
  storage: PhotoStorage,
  studioId: string,
  jobId: string,
  photos: DbPhoto[],
): Promise<ShopPhoto[]> {
  return Promise.all(
    photos.map(async (p) => {
      const ids = { studioId, jobId, photoId: p.id };
      const [thumbUrl, viewUrl] = await Promise.all([
        signParentPreview(storage, ids, "proof-thumb.webp"),
        signParentPreview(storage, ids, "proof.webp"),
      ]);
      return { id: p.id, thumbUrl, viewUrl, width: p.width, height: p.height };
    }),
  );
}

// ── Database answers as API shapes ────────────────────────────────────────────────────────────────────────────────

interface DbSession {
  studio_name: string;
  expires_at: string;
  shipping_method: ShopShippingMethod | null;
  bag_count: number;
  children: {
    id: string;
    first_name: string;
    last_initial: string;
    job_id: string;
    school: string;
    picture_day: string;
    closes_at: string | null;
    deliver_to_school: boolean;
    state: ShopChildState;
  }[];
}

export function toShopSession(row: DbSession): ShopSessionResponse {
  return {
    studio: { name: row.studio_name },
    expiresAt: row.expires_at,
    bagCount: Number(row.bag_count),
    children: row.children.map(
      (c): ShopChild => ({
        id: c.id,
        displayName: parentDisplayName(c.first_name, c.last_initial),
        firstName: c.first_name,
        jobId: c.job_id,
        school: c.school,
        pictureDay: c.picture_day,
        closesAt: c.closes_at,
        deliverToSchool: c.deliver_to_school,
        state: c.state,
      }),
    ),
  };
}

interface DbGallery {
  state: ShopChildState;
  studio_id: string;
  job_id: string;
  portraits: DbPhoto[];
  class_photos: DbPhoto[];
}

export async function toShopGallery(
  region: DataRegion,
  row: DbGallery,
): Promise<ShopGalleryResponse> {
  if (row.state !== "open" || (row.portraits.length === 0 && row.class_photos.length === 0))
    return { state: row.state, cover: null, portraits: [], classPhotos: [] };
  assertStorageRegion(region);
  const storage = photoStorage(region);
  const [portraits, classPhotos] = await Promise.all([
    signPhotos(storage, row.studio_id, row.job_id, row.portraits),
    signPhotos(storage, row.studio_id, row.job_id, row.class_photos),
  ]);
  return { state: row.state, cover: pickCoverPhoto(portraits), portraits, classPhotos };
}

interface DbPriceList {
  state: ShopChildState;
  currency?: Currency;
  home_shipping_cents?: number;
  deliver_to_school?: boolean;
  items?: {
    id: string;
    kind: PriceItemKind;
    name: string;
    description: string | null;
    print_size: PrintSize | null;
    price_cents: number;
    contents: { kind: PackageLineKind; print_size: PrintSize | null; quantity: number }[];
  }[];
}

export function toShopPriceList(row: DbPriceList): ShopPriceListResponse {
  if (row.state !== "open" || !row.currency) return { state: row.state, priceList: null };
  const currency = row.currency;
  return {
    state: row.state,
    priceList: {
      currency,
      homeShipping: { cents: Number(row.home_shipping_cents ?? 0), currency },
      deliverToSchool: Boolean(row.deliver_to_school),
      items: (row.items ?? []).map(
        (i): ShopItem => ({
          id: i.id,
          kind: i.kind,
          name: i.name,
          description: i.description,
          printSize: i.print_size,
          price: { cents: Number(i.price_cents), currency },
          contents: i.contents.map((c) => ({
            kind: c.kind,
            printSize: c.print_size,
            quantity: c.quantity,
          })),
        }),
      ),
    },
  };
}

interface DbCart {
  studio_id: string;
  shipping_method: ShopShippingMethod | null;
  lines: {
    id: string;
    child_id: string;
    job_id: string;
    item_id: string;
    kind: PriceItemKind;
    name: string;
    print_size: PrintSize | null;
    price_cents: number;
    currency: Currency;
    quantity: number;
    photo_id: string | null;
    physical: boolean;
    available: boolean;
  }[];
  jobs: {
    job_id: string;
    deliver_to_school: boolean;
    home_shipping_cents: number;
    currency: Currency;
  }[];
}

/** The bag priced now (packages/core cartTotals), with the poses of lines that can still be bought signed. */
export async function toShopCart(region: DataRegion, row: DbCart): Promise<ShopCartResponse> {
  const studioId = row.studio_id;
  const currency: Currency = row.lines[0]?.currency ?? row.jobs[0]?.currency ?? "CAD";
  const facts = row.lines.map((l) => ({
    jobId: l.job_id,
    priceCents: Number(l.price_cents),
    quantity: l.quantity,
    available: l.available,
    physical: l.physical,
  }));
  const totals = cartTotals(
    facts,
    row.jobs.map((j) => ({
      jobId: j.job_id,
      homeShippingCents: Number(j.home_shipping_cents),
      deliverToSchool: j.deliver_to_school,
    })),
    row.shipping_method,
  );
  const signing = row.lines.some((l) => l.available && l.photo_id);
  let storage: PhotoStorage | null = null;
  if (signing) {
    assertStorageRegion(region);
    storage = photoStorage(region);
  }
  const money = (cents: number) => ({ cents, currency });
  const lines = await Promise.all(
    row.lines.map(async (l) => ({
      id: l.id,
      childId: l.child_id,
      itemId: l.item_id,
      kind: l.kind,
      name: l.name,
      printSize: l.print_size,
      unitPrice: money(Number(l.price_cents)),
      quantity: l.quantity,
      lineTotal: money(Number(l.price_cents) * l.quantity),
      available: l.available,
      physical: l.physical,
      photo: l.photo_id
        ? {
            id: l.photo_id,
            thumbUrl:
              l.available && storage
                ? await signParentPreview(
                    storage,
                    { studioId, jobId: l.job_id, photoId: l.photo_id },
                    "proof-thumb.webp",
                  )
                : null,
          }
        : null,
    })),
  );
  return {
    lines,
    count: totals.count,
    subtotal: money(totals.subtotalCents),
    shipping: {
      needed: totals.shipping.needed,
      home: money(totals.shipping.homeCents),
      school: totals.shipping.school,
      method: totals.shipping.method,
      cost: totals.shipping.cents === null ? null : money(totals.shipping.cents),
    },
    total: totals.totalCents === null ? null : money(totals.totalCents),
  };
}

/** The bag, read and priced now. */
export async function readCart(session: ShopCookieSession): Promise<ShopCartResponse> {
  const row = await shop<DbCart>(session.region, "shop_cart", { p_session_hash: session.hash });
  return toShopCart(session.region, row);
}
