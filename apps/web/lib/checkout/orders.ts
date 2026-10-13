import "server-only";
import type {
  OrdersResponse,
  ShopOrder,
  ShopOrderChild,
  ShopOrderSummary,
  StudioOrder,
  StudioOrderDetail,
} from "@daybell/api";
import {
  type Currency,
  type OrderStatus,
  type PackageLineKind,
  type PriceItemKind,
  type PrintSize,
  type PstProvince,
  parentDisplayName,
  type ShopShippingMethod,
  type TaxRegistrationKind,
} from "@daybell/core";

/**
 * Orders as the API shows them (ADR 0023): the database's rows for parents (call 12: never an email, an address or a
 * last name, and no amounts in the child view) and for owners and admins (call 15), in whole cents with the currency
 * (D96).
 */

const money = (cents: number | string, currency: Currency) => ({ cents: Number(cents), currency });

type DbChild =
  | { id: string; state: "open"; first_name: string; last_initial: string }
  | { id: string; state: "closed" | "unavailable" };

export function toShopOrderChild(c: DbChild): ShopOrderChild {
  return c.state === "open"
    ? { id: c.id, state: "open", displayName: parentDisplayName(c.first_name, c.last_initial) }
    : { id: c.id, state: c.state };
}

export interface DbShopOrderSummary {
  id: string;
  reference: string;
  status: OrderStatus;
  view: "full" | "child";
  paid_at: string | null;
  created_at: string;
  children: DbChild[];
  downloads: number;
}

const iso = (value: string) => new Date(value).toISOString();

export function toShopOrderSummary(row: DbShopOrderSummary): ShopOrderSummary {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    view: row.view,
    paidAt: row.paid_at ? iso(row.paid_at) : null,
    createdAt: iso(row.created_at),
    children: row.children.map(toShopOrderChild),
    downloads: Number(row.downloads),
  };
}

export interface DbShopOrder {
  id: string;
  reference: string;
  status: OrderStatus;
  view: "full" | "child";
  paid_at: string | null;
  created_at: string;
  currency: Currency;
  studio_name: string;
  shipping_method: ShopShippingMethod | null;
  totals: {
    products_cents: number;
    shipping_cents: number;
    tax_cents: number | null;
    total_cents: number | null;
  } | null;
  registrations: { kind: TaxRegistrationKind; province: PstProvince | null; number: string }[];
  children: DbChild[];
  lines: {
    id: string;
    child_id: string | null;
    kind: PriceItemKind;
    name: string;
    print_size: PrintSize | null;
    quantity: number;
    unit_price_cents: number | null;
    line_total_cents: number | null;
    contents: { kind: PackageLineKind; print_size: PrintSize | null; quantity: number }[];
    downloads: string[];
  }[];
}

/** An order for its parent. Downloads are numbered across the order (the files' names and the buttons' words). */
export function toShopOrder(row: DbShopOrder): ShopOrder {
  const c = row.currency;
  let n = 0;
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    view: row.view,
    paidAt: row.paid_at ? iso(row.paid_at) : null,
    createdAt: iso(row.created_at),
    studio: { name: row.studio_name },
    shippingMethod: row.shipping_method,
    totals: row.totals
      ? {
          products: money(row.totals.products_cents, c),
          shipping: money(row.totals.shipping_cents, c),
          tax: row.totals.tax_cents === null ? null : money(row.totals.tax_cents, c),
          total: row.totals.total_cents === null ? null : money(row.totals.total_cents, c),
        }
      : null,
    registrations: row.registrations,
    children: row.children.map(toShopOrderChild),
    lines: row.lines.map((l) => ({
      id: l.id,
      childId: l.child_id,
      kind: l.kind,
      name: l.name,
      printSize: l.print_size,
      quantity: l.quantity,
      unitPrice: l.unit_price_cents === null ? null : money(l.unit_price_cents, c),
      lineTotal: l.line_total_cents === null ? null : money(l.line_total_cents, c),
      contents: l.contents.map((x) => ({
        kind: x.kind,
        printSize: x.print_size,
        quantity: x.quantity,
      })),
      downloads: l.downloads.map((photoId) => ({ photoId, n: ++n })),
    })),
  };
}

// ── The studio's view (owners and admins) ─────────────────────────────────────────────────────────────────────────

interface DbStudioOrderBase {
  id: string;
  reference: string;
  paid_at: string;
  currency: Currency;
  products_cents: number;
  shipping_cents: number;
  tax_cents: number;
  total_cents: number;
  daybell_fee_bps: number;
  daybell_fee_cents: number;
  stripe_fee_cents: number | null;
  shipping_method: ShopShippingMethod | null;
}

export interface DbStudioOrder extends DbStudioOrderBase {
  items: number;
  children: { id: string; first_name: string; last_name: string }[];
}

function studioOrderAmounts(row: DbStudioOrderBase) {
  const c = row.currency;
  const stripe = row.stripe_fee_cents === null ? null : Number(row.stripe_fee_cents);
  return {
    id: row.id,
    reference: row.reference,
    paidAt: iso(row.paid_at),
    products: money(row.products_cents, c),
    shipping: money(row.shipping_cents, c),
    tax: money(row.tax_cents, c),
    total: money(row.total_cents, c),
    daybellFee: { basisPoints: row.daybell_fee_bps, amount: money(row.daybell_fee_cents, c) },
    cardFee: stripe === null ? null : money(stripe, c),
    // What reaches the studio's Stripe balance: the total less both fees (core studioReceivesCents).
    paidToStudio:
      stripe === null
        ? null
        : money(Number(row.total_cents) - Number(row.daybell_fee_cents) - stripe, c),
    shippingMethod: row.shipping_method,
  };
}

const person = (p: { id: string; first_name: string; last_name: string }) => ({
  id: p.id,
  firstName: p.first_name,
  lastName: p.last_name,
});

export function toStudioOrder(row: DbStudioOrder): StudioOrder {
  return {
    ...studioOrderAmounts(row),
    items: Number(row.items),
    children: row.children.map(person),
  };
}

/** A page of a job's orders: `limit + 1` rows asked for, the extra one says there is a next page. */
export function toOrdersPage(rows: DbStudioOrder[], limit: number): OrdersResponse {
  const page = rows.slice(0, limit);
  return {
    orders: page.map(toStudioOrder),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

export interface DbStudioOrderDetail extends DbStudioOrderBase {
  lines: {
    id: string;
    kind: PriceItemKind;
    name: string;
    print_size: PrintSize | null;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    photo_id: string | null;
    child: { id: string; first_name: string; last_name: string } | null;
    contents: { kind: PackageLineKind; print_size: PrintSize | null; quantity: number }[];
  }[];
  ship_to: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    province: string | null;
    postal_code: string;
    country: "CA";
  } | null;
}

export function toStudioOrderDetail(row: DbStudioOrderDetail): StudioOrderDetail {
  const c = row.currency;
  return {
    ...studioOrderAmounts(row),
    lines: row.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      name: l.name,
      printSize: l.print_size,
      quantity: l.quantity,
      unitPrice: money(l.unit_price_cents, c),
      lineTotal: money(l.line_total_cents, c),
      child: l.child ? person(l.child) : null,
      photoId: l.photo_id,
      contents: l.contents.map((x) => ({
        kind: x.kind,
        printSize: x.print_size,
        quantity: x.quantity,
      })),
    })),
    shipTo: row.ship_to
      ? {
          name: row.ship_to.name,
          line1: row.ship_to.line1,
          line2: row.ship_to.line2,
          city: row.ship_to.city,
          province: row.ship_to.province,
          postalCode: row.ship_to.postal_code,
          country: row.ship_to.country,
        }
      : null,
  };
}
