import "server-only";
import type { ShopOrder, ShopOrderChild, ShopOrderSummary } from "@daybell/api";
import {
  type Currency,
  type OrderFulfilment,
  type OrderStatus,
  type PackageLineKind,
  type PriceItemKind,
  type PrintSize,
  type PstProvince,
  parentDisplayName,
  type RefundBadge,
  type ShopShippingMethod,
  type TaxRegistrationKind,
} from "@daybell/core";
import { type DbTracking, toTracking } from "../orders/views";

/**
 * Orders as parents see them (ADR 0023, 0024): the database's rows (call 12: never an email, an address or a last name,
 * and no amounts in the child view), in whole cents with the currency (D96). The studio's view is lib/orders/views.ts.
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
  fulfilment: OrderFulfilment | null;
  refund: RefundBadge | null;
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
    fulfilment: row.fulfilment ?? null,
    refund: row.refund ?? null,
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
  fulfilment: OrderFulfilment | null;
  refund: RefundBadge | null;
  can_cancel: boolean;
  tracking: DbTracking | null;
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
    refunded_cents: number;
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
    refunded_quantity: number;
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
    fulfilment: row.fulfilment ?? null,
    refund: row.refund ?? null,
    canCancel: Boolean(row.can_cancel),
    tracking: toTracking(row.tracking ?? null),
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
          refunded: money(row.totals.refunded_cents ?? 0, c),
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
      refundedQuantity: Number(l.refunded_quantity ?? 0),
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
