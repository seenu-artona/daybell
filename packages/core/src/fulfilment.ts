/**
 * Orders after payment (Phase 1 step 11; D25, D127; Seenu's answers 2–4 and Q4–Q6 of Oct 13, 2026; Claude's calls;
 * ADR 0024). The database enforces the same rules (migration 20261013100100_orders_and_refunds.sql:
 * app.guard_order_fulfilment, mark_order_status, undo_order_status); these are them in one readable place for the API
 * and the screens.
 */
import type { ShopShippingMethod } from "./shop";

/**
 * Paid → Printed → Shipped (home, with tracking) or Delivered to school. A digital-only order is Complete at payment;
 * a parent's cancel makes it Canceled. Refunded and Partly refunded are a separate badge, never a status.
 */
export const ORDER_FULFILMENTS = [
  "paid",
  "printed",
  "shipped",
  "delivered",
  "complete",
  "canceled",
] as const;
export type OrderFulfilment = (typeof ORDER_FULFILMENTS)[number];

/** The carriers a studio ships with (Claude's call): "other" takes a link to its own tracking page. */
export const CARRIERS = ["canada_post", "purolator", "ups", "fedex", "other"] as const;
export type Carrier = (typeof CARRIERS)[number];

/** Why a step was taken back (a fixed list: no free text, no personal data). */
export const STATUS_UNDO_REASONS = [
  "marked_by_mistake",
  "reprint_needed",
  "wrong_tracking",
  "other",
] as const;
export type StatusUndoReason = (typeof STATUS_UNDO_REASONS)[number];

/** The refund badge, apart from the status. */
export type RefundBadge = "refunded" | "partly_refunded";

type Role = string;

/** Who sees orders (Q4): owners, admins and staff. Photographers don't (prices aren't their business). */
export function canSeeOrders(role: Role): boolean {
  return role === "owner" || role === "admin" || role === "staff";
}

/** Who marks orders Printed, Shipped or Delivered to school (answer 4). */
export function canFulfil(role: Role): boolean {
  return canSeeOrders(role);
}

/** Who refunds (answer 3). */
export function canRefund(role: Role): boolean {
  return role === "owner" || role === "admin";
}

/** Who takes a step back (Claude's call). */
export function canUndoStatus(role: Role): boolean {
  return canRefund(role);
}

/** Who sees Home's money, the ledger and refunds (Q4): owners and admins; staff see To do only. */
export function canSeeSales(role: Role): boolean {
  return canRefund(role);
}

/** The next step an order can take, if any: printing, then shipping (home) or delivering to school. */
export function fulfilmentNext(
  status: OrderFulfilment,
  shippingMethod: ShopShippingMethod | null,
): "printed" | "shipped" | "delivered" | null {
  if (status === "paid") return "printed";
  if (status === "printed" && shippingMethod === "home") return "shipped";
  if (status === "printed" && shippingMethod === "school") return "delivered";
  return null;
}

/** The step an undo goes back to, if any (one step only). */
export function fulfilmentPrevious(status: OrderFulfilment): "paid" | "printed" | null {
  if (status === "printed") return "paid";
  if (status === "shipped" || status === "delivered") return "printed";
  return null;
}

/** The stepper's steps for an order's delivery: what it goes through, in order. */
export function fulfilmentSteps(
  shippingMethod: ShopShippingMethod | null,
): readonly ("paid" | "printed" | "shipped" | "delivered" | "complete")[] {
  if (shippingMethod === "home") return ["paid", "printed", "shipped"];
  if (shippingMethod === "school") return ["paid", "printed", "delivered"];
  return ["complete"];
}

/** A tracking number as kept: trimmed, single spaces, upper case; 4 to 40 letters, digits, spaces and dashes. */
export const TRACKING_NUMBER = /^[A-Z0-9 -]{4,40}$/;

export function normalizeTrackingNumber(text: string): string | null {
  const plain = text.trim().replace(/\s+/g, " ").toUpperCase();
  return TRACKING_NUMBER.test(plain) ? plain : null;
}

/**
 * Where a parent or the studio follows a shipment: the carrier's tracking page with the number in it (templates in
 * packages/config CARRIER_TRACKING_URLS), or the link the studio gave for "other". Null when there is none.
 */
export function trackingLink(
  templates: Readonly<Record<Exclude<Carrier, "other">, string>>,
  tracking: { carrier: Carrier; number: string; url: string | null },
): string | null {
  if (tracking.carrier === "other") return tracking.url;
  const template = templates[tracking.carrier];
  return template.replace("{number}", encodeURIComponent(tracking.number.replace(/\s+/g, "")));
}

/**
 * Whether the parent may cancel (answer 2; Q5, Q6): the session that paid, while the order is Paid (not yet Printed;
 * never a digital-only order, which is Complete), something is left to refund and no refund is on its way.
 */
export function canParentCancel(order: {
  isPayer: boolean;
  fulfilment: OrderFulfilment;
  fullyRefunded: boolean;
  refundInFlight: boolean;
}): boolean {
  return (
    order.isPayer && order.fulfilment === "paid" && !order.fullyRefunded && !order.refundInFlight
  );
}
