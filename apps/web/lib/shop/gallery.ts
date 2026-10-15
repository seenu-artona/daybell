import "server-only";
import type {
  ShopCartResponse,
  ShopChild,
  ShopChildState,
  ShopGalleryResponse,
  ShopGallerySession,
  ShopItem,
  ShopPhoto,
  ShopPriceListResponse,
} from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  type Currency,
  cartTotals,
  type PackageLineKind,
  type PriceItemKind,
  type PrintSize,
  parentDisplayName,
  photoKey,
  pickCoverPhoto,
  SHOP_PREVIEW_SECONDS,
  type ShopShippingMethod,
} from "@daybell/core";
import type { PhotoStorage } from "@daybell/storage";
import { photoStorage } from "../photo-storage";
import { assertStorageRegion } from "../region-guard";
import { callShopFunction } from "./http";
import type { ShopCookieSession } from "./session";

/**
 * The parent shop's answers (ADR 0022 §4–6): the database's rows as API shapes, with the watermarked previews signed.
 * Parents only ever get proof previews (D60), signed in Montréal from S3 ca-central-1 (D113).
 */

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
  /** The large view is protected (ADR 0034): the switch on and the clip ready. Absent in older rows: false. */
  drm?: boolean;
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
      return {
        id: p.id,
        thumbUrl,
        viewUrl,
        width: p.width,
        height: p.height,
        drm: p.drm === true,
      };
    }),
  );
}

// ── The session ───────────────────────────────────────────────────────────────────────────────────────────────────

export interface DbSession {
  studio_name: string;
  expires_at: string;
  shipping_method: ShopShippingMethod | null;
  bag_count: number;
  children: (
    | {
        id: string;
        state: "open";
        first_name: string;
        last_initial: string;
        job_id: string;
        school: string;
        picture_day: string;
        closes_at: string | null;
        deliver_to_school: boolean;
      }
    | { id: string; state: "closed" | "unavailable" }
  )[];
}

/** One gallery of the device. A child whose shop isn't open is only an id and a state (security review M1). */
export function toShopGallerySession(galleryId: string, row: DbSession): ShopGallerySession {
  return {
    id: galleryId,
    studio: { name: row.studio_name },
    expiresAt: row.expires_at,
    bagCount: Number(row.bag_count),
    children: row.children.map(
      (c): ShopChild =>
        c.state === "open"
          ? {
              id: c.id,
              state: "open",
              displayName: parentDisplayName(c.first_name, c.last_initial),
              firstName: c.first_name,
              jobId: c.job_id,
              school: c.school,
              pictureDay: c.picture_day,
              closesAt: c.closes_at,
              deliverToSchool: c.deliver_to_school,
            }
          : { id: c.id, state: c.state },
    ),
  };
}

// ── The gallery and prices ────────────────────────────────────────────────────────────────────────────────────────

interface DbGallery {
  state: ShopChildState;
  studio_id?: string;
  job_id?: string;
  portraits?: DbPhoto[];
  group_photos?: DbPhoto[];
}

export async function toShopGallery(
  region: DataRegion,
  row: DbGallery,
): Promise<ShopGalleryResponse> {
  const portraits = row.portraits ?? [];
  const groups = row.group_photos ?? [];
  if (
    row.state !== "open" ||
    !row.studio_id ||
    !row.job_id ||
    (portraits.length === 0 && groups.length === 0)
  )
    return { state: row.state, cover: null, portraits: [], groupPhotos: [] };
  assertStorageRegion(region);
  const storage = photoStorage(region);
  const [signedPortraits, groupPhotos] = await Promise.all([
    signPhotos(storage, row.studio_id, row.job_id, portraits),
    signPhotos(storage, row.studio_id, row.job_id, groups),
  ]);
  return {
    state: row.state,
    cover: pickCoverPhoto(signedPortraits),
    portraits: signedPortraits,
    groupPhotos,
  };
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

// ── The bag ───────────────────────────────────────────────────────────────────────────────────────────────────────

interface DbCart {
  studio_id: string;
  currency: Currency;
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

/** The bag priced now (packages/core cartTotals), in the studio's currency, with available lines' poses signed. */
export async function toShopCart(region: DataRegion, row: DbCart): Promise<ShopCartResponse> {
  const studioId = row.studio_id;
  const currency = row.currency;
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

/** A gallery's bag, read and priced now. */
export async function readCart(session: ShopCookieSession): Promise<ShopCartResponse> {
  const row = await callShopFunction<DbCart>(session.region, "shop_cart", {
    p_session_hash: session.hash,
  });
  return toShopCart(session.region, row);
}
