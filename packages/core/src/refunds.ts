/**
 * Refunds (Phase 1 step 11; D59, D96; Seenu's answers 1 and 3, Q1–Q3 of Oct 13, 2026; ADR 0024). Money is whole cents,
 * never floats (D96). The database does the same sums (app.refund_split, app.write_refund_ledger in migration
 * 20261013100100); the refund dialog uses these for its live summary, and the unit tests pin them.
 */
import type { RefundBadge } from "./fulfilment";

export const REFUND_KINDS = ["lines", "custom", "cancel"] as const;
export type RefundKind = (typeof REFUND_KINDS)[number];

export const REFUND_STATUSES = ["requested", "pending", "succeeded", "failed", "canceled"] as const;
export type RefundStatus = (typeof REFUND_STATUSES)[number];

/** Why a studio refunded: a fixed list, never free text (no personal data; Claude's call). */
export const REFUND_REASONS = [
  "parent_asked",
  "damaged",
  "wrong_item",
  "quality",
  "duplicate",
  "other",
] as const;
export type RefundReason = (typeof REFUND_REASONS)[number];

/** The refund reason sent to Stripe: a parent asking (or their cancel), or a duplicate; never "fraudulent". */
export function stripeRefundReason(
  kind: RefundKind,
  reason: RefundReason | null,
): "requested_by_customer" | "duplicate" | null {
  if (kind === "cancel" || reason === "parent_asked") return "requested_by_customer";
  if (reason === "duplicate") return "duplicate";
  return null;
}

/** What the order took, as it was paid. */
export interface RefundableOrder {
  productsCents: number;
  shippingCents: number;
  taxCents: number;
  daybellFeeCents: number;
  daybellFeeBps: number;
}

/** What earlier refunds (written, not failed or abandoned) have given back. */
export interface RefundedSoFar {
  productsCents: number;
  shippingCents: number;
  taxCents: number;
  feeCents: number;
}

export interface RefundSplit {
  productsCents: number;
  shippingCents: number;
  taxCents: number;
  /** Daybell's fee given back (answer 1). */
  feeCents: number;
  /** What the parent gets back: products, shipping and tax. */
  amountCents: number;
  /** What the studio gives back from its transfer: the refund less Daybell's fee on it (Q1). */
  studioCents: number;
}

export class RefundRefused extends Error {
  constructor(readonly code: "over_refund" | "nothing_to_refund") {
    super(code);
    this.name = "RefundRefused";
  }
}

const cents = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Money must be a whole number of cents");
  return n;
};

/** n × num / den, rounded half up, for non-negative whole numbers (BigInt: never a float, never an overflow). */
export function mulDivHalfUp(n: number, num: number, den: number): number {
  if (den <= 0) throw new Error("A positive divisor");
  const out = (BigInt(n) * BigInt(num) * 2n + BigInt(den)) / (BigInt(den) * 2n);
  return Number(out);
}

/**
 * A refund's amounts (ADR 0024 §split): products p and shipping s as asked; tax x = round_half_up(tax × (p + s) /
 * (products + shipping)) and Daybell's fee a = round_half_up(p × rate), each no more than is left; the refund that
 * leaves nothing takes the exact remainders, so the refunds add up to exactly what was paid.
 */
export function refundSplit(
  order: RefundableOrder,
  done: RefundedSoFar,
  ask: { productsCents: number; shippingCents: number },
): RefundSplit {
  const p = cents(ask.productsCents);
  const s = cents(ask.shippingCents);
  const leftProducts = order.productsCents - done.productsCents;
  const leftShipping = order.shippingCents - done.shippingCents;
  if (p > leftProducts || s > leftShipping) throw new RefundRefused("over_refund");
  if (p + s === 0) throw new RefundRefused("nothing_to_refund");
  const empties =
    done.productsCents + p === order.productsCents &&
    done.shippingCents + s === order.shippingCents;
  const base = order.productsCents + order.shippingCents;
  const tax = empties
    ? order.taxCents - done.taxCents
    : Math.min(mulDivHalfUp(order.taxCents, p + s, base), order.taxCents - done.taxCents);
  const fee = empties
    ? order.daybellFeeCents - done.feeCents
    : Math.min(mulDivHalfUp(p, order.daybellFeeBps, 10_000), order.daybellFeeCents - done.feeCents);
  const amount = p + s + tax;
  return {
    productsCents: p,
    shippingCents: s,
    taxCents: tax,
    feeCents: fee,
    amountCents: amount,
    studioCents: amount - fee,
  };
}

export type RefundLedgerAccount = "refunds" | "tax_payable" | "daybell_fees" | "studio_payable";

/**
 * A refund's ledger transaction (sign convention of ADR 0023: positive is a debit): refunds −amount, tax_payable
 * +tax, daybell_fees +fee, studio_payable +(amount − tax − fee). Balanced; zero lines left out.
 */
export function refundLedger(
  split: Pick<RefundSplit, "amountCents" | "taxCents" | "feeCents">,
): { account: RefundLedgerAccount; cents: number }[] {
  const lines: { account: RefundLedgerAccount; cents: number }[] = [
    { account: "refunds", cents: -split.amountCents },
    { account: "tax_payable", cents: split.taxCents },
    { account: "daybell_fees", cents: split.feeCents },
    { account: "studio_payable", cents: split.amountCents - split.taxCents - split.feeCents },
  ];
  return lines.filter((l) => l.cents !== 0);
}

/** The badge from what Stripe has accepted: Refunded when all of it, Partly refunded when some. */
export function refundState(totalCents: number, refundedCents: number): RefundBadge | null {
  if (refundedCents <= 0) return null;
  return refundedCents >= totalCents ? "refunded" : "partly_refunded";
}
