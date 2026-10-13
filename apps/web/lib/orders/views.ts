import "server-only";
import type {
  LedgerTransaction,
  OrdersResponse,
  Refund,
  SalesResponse,
  StudioOrder,
  StudioOrderDetail,
} from "@daybell/api";
import { CARRIER_TRACKING_URLS } from "@daybell/config";
import {
  averageOrderCents,
  type Carrier,
  type Currency,
  type OrderFulfilment,
  type PackageLineKind,
  type PriceItemKind,
  type PrintSize,
  parentDisplayName,
  type RefundBadge,
  type RefundKind,
  type RefundReason,
  type RefundStatus,
  type SalesRange,
  type ShopShippingMethod,
  trackingLink,
} from "@daybell/core";

/**
 * Orders as the studio sees them (ADR 0024): the database's rows (studio_orders, studio_order, studio_sales) in whole
 * cents with the currency (D96). Owners and admins get refunds, what is left to refund and the ledger; staff get null
 * for all three (Q4: the database's row-level security already gives them none, and the API says so plainly).
 */

const money = (cents: number | string, currency: Currency) => ({ cents: Number(cents), currency });
const iso = (value: string) => new Date(value).toISOString();
const isoOrNull = (value: string | null) => (value ? iso(value) : null);

export interface DbTracking {
  carrier: Carrier;
  number: string;
  url: string | null;
}

/** Tracking with where to follow it: the carrier's page, or the studio's own link for "other". */
export function toTracking(t: DbTracking | null) {
  if (!t) return null;
  return {
    carrier: t.carrier,
    number: t.number,
    url: t.url,
    link: trackingLink(CARRIER_TRACKING_URLS, t),
  };
}

export interface DbStudioOrder {
  id: string;
  reference: string;
  paid_at: string;
  currency: Currency;
  total_cents: number;
  shipping_method: ShopShippingMethod | null;
  fulfilment: OrderFulfilment;
  disputed: boolean;
  refund: RefundBadge | null;
  items: number;
  children: { id: string; first_name: string; last_initial: string }[];
}

export function toStudioOrder(row: DbStudioOrder): StudioOrder {
  return {
    id: row.id,
    reference: row.reference,
    paidAt: iso(row.paid_at),
    total: money(row.total_cents, row.currency),
    shippingMethod: row.shipping_method,
    fulfilment: row.fulfilment,
    refund: row.refund ?? null,
    disputed: row.disputed,
    items: Number(row.items),
    children: row.children.map((c) => ({
      id: c.id,
      displayName: parentDisplayName(c.first_name, c.last_initial),
    })),
  };
}

/** A page of orders: `limit + 1` rows asked for, the extra one says there is a next page. */
export function toOrdersPage(rows: DbStudioOrder[], limit: number): OrdersResponse {
  const page = rows.slice(0, limit);
  return {
    orders: page.map(toStudioOrder),
    nextCursor: rows.length > limit ? (page.at(-1)?.id ?? null) : null,
  };
}

interface DbRefund {
  id: string;
  kind: RefundKind;
  reason: RefundReason | null;
  status: RefundStatus;
  products_cents: number;
  shipping_cents: number;
  tax_cents: number;
  amount_cents: number;
  daybell_fee_cents: number;
  unrecovered_cents: number;
  created_at: string;
  lines: { line_id: string; quantity: number }[];
}

export function toRefund(row: DbRefund, currency: Currency): Refund {
  return {
    id: row.id,
    kind: row.kind,
    reason: row.reason,
    status: row.status,
    products: money(row.products_cents, currency),
    shipping: money(row.shipping_cents, currency),
    tax: money(row.tax_cents, currency),
    amount: money(row.amount_cents, currency),
    daybellFee: money(row.daybell_fee_cents, currency),
    unrecovered: money(row.unrecovered_cents, currency),
    createdAt: iso(row.created_at),
    lines: row.lines.map((l) => ({ lineId: l.line_id, quantity: Number(l.quantity) })),
  };
}

export interface DbStudioOrderDetail {
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
  fees_settled: boolean;
  shipping_method: ShopShippingMethod | null;
  fulfilment: OrderFulfilment;
  printed_at: string | null;
  shipped_at: string | null;
  delivered_at: string | null;
  canceled_at: string | null;
  disputed_at: string | null;
  ship_to_purged_at: string | null;
  external_refund_at: string | null;
  external_refund_checked_at: string | null;
  tracking: DbTracking | null;
  refund_state: {
    badge: RefundBadge | null;
    in_flight: boolean;
    fully_refunded: boolean;
    lines: Record<string, number>;
  } | null;
  lines: {
    id: string;
    kind: PriceItemKind;
    name: string;
    print_size: PrintSize | null;
    quantity: number;
    unit_price_cents: number;
    line_total_cents: number;
    photo_id: string | null;
    physical: boolean;
    child: { id: string; first_name: string; last_name: string } | null;
    contents: { kind: PackageLineKind; print_size: PrintSize | null; quantity: number }[];
  }[];
  refunds: DbRefund[];
  refundable: {
    products_cents: number;
    shipping_cents: number;
    tax_cents: number;
    daybell_fee_cents: number;
    refunded_cents: number;
  };
  ledger: {
    id: string;
    kind: LedgerTransaction["kind"];
    created_at: string;
    entries: { id: number; account: string; amount_cents: number }[];
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

/** One order for the studio; `money` is whether this person sees refunds and the ledger (owners and admins, Q4). */
export function toStudioOrderDetail(
  row: DbStudioOrderDetail,
  seesMoney: boolean,
): StudioOrderDetail {
  const c = row.currency;
  const stripe = row.stripe_fee_cents === null ? null : Number(row.stripe_fee_cents);
  const refunded = row.refund_state?.lines ?? {};
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
    feesSettled: row.fees_settled,
    shippingMethod: row.shipping_method,
    fulfilment: row.fulfilment,
    printedAt: isoOrNull(row.printed_at),
    shippedAt: isoOrNull(row.shipped_at),
    deliveredAt: isoOrNull(row.delivered_at),
    canceledAt: isoOrNull(row.canceled_at),
    disputedAt: isoOrNull(row.disputed_at),
    shipToPurgedAt: isoOrNull(row.ship_to_purged_at),
    externalRefund: row.external_refund_at
      ? { at: iso(row.external_refund_at), checkedAt: isoOrNull(row.external_refund_checked_at) }
      : null,
    tracking: toTracking(row.tracking),
    refund: row.refund_state?.badge ?? null,
    refundInFlight: row.refund_state?.in_flight ?? false,
    lines: row.lines.map((l) => ({
      id: l.id,
      kind: l.kind,
      name: l.name,
      printSize: l.print_size,
      quantity: l.quantity,
      refundedQuantity: Number(refunded[l.id] ?? 0),
      unitPrice: money(l.unit_price_cents, c),
      lineTotal: money(l.line_total_cents, c),
      physical: l.physical,
      child: l.child
        ? { id: l.child.id, firstName: l.child.first_name, lastName: l.child.last_name }
        : null,
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
    refunds: seesMoney ? row.refunds.map((r) => toRefund(r, c)) : null,
    refundable: seesMoney
      ? {
          products: money(row.refundable.products_cents, c),
          shipping: money(row.refundable.shipping_cents, c),
          tax: money(row.refundable.tax_cents, c),
          daybellFee: money(row.refundable.daybell_fee_cents, c),
          refunded: money(row.refundable.refunded_cents, c),
        }
      : null,
    ledger: seesMoney
      ? row.ledger.map((t) => ({
          id: t.id,
          kind: t.kind,
          createdAt: iso(t.created_at),
          entries: t.entries.map((e) => ({
            id: Number(e.id),
            account: e.account,
            amount: money(e.amount_cents, c),
          })),
        }))
      : null,
  };
}

export interface DbSales {
  currency: Currency;
  ranges: Record<
    SalesRange,
    { start: string; sales_cents: number; orders: number; daybell_fee_cents: number }
  >;
}

export interface DbTodo {
  to_print: number;
  to_ship: number;
  to_deliver: number;
}

export function toSales(sales: DbSales | null, todo: DbTodo): SalesResponse {
  const summary = (range: SalesRange) => {
    const r = (sales as DbSales).ranges[range];
    const cents = Number(r.sales_cents);
    const orders = Number(r.orders);
    const average = averageOrderCents(cents, orders);
    const c = (sales as DbSales).currency;
    return {
      start: iso(r.start),
      sales: money(cents, c),
      orders,
      daybellFee: money(r.daybell_fee_cents, c),
      averageOrder: average === null ? null : money(average, c),
    };
  };
  return {
    sales: sales
      ? { today: summary("today"), week: summary("week"), season: summary("season") }
      : null,
    todo: {
      toPrint: Number(todo.to_print),
      toShip: Number(todo.to_ship),
      toDeliver: Number(todo.to_deliver),
    },
  };
}
