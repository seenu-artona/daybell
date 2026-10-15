/**
 * Checkout and orders (Phase 1 step 10; D59, D96, D98, D104, D106; Seenu's answers 1–4 and Claude's calls 1–20 of Oct
 * 13, 2026; ADR 0023). Money is whole cents (D96), never floats. The database does the same sums
 * (packages/db migration 20261013000000_checkout.sql: app.daybell_fee_cents, settle_order_fees); these are the rules in
 * one readable place, for the API and the screens, and the unit tests that pin them.
 */
import type { Currency } from "./money";
import type { PackageLineKind, PriceItemKind } from "./price-lists";

export const ORDER_STATUSES = ["pending", "paid", "expired", "failed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

/** Daybell's fee at launch: 3% of product sales (D59). The rate itself is a database setting (Seenu, answer 1). */
export const DEFAULT_DAYBELL_FEE_BPS = 300;
/** The setting's bounds: 0 to 20% (call 16). */
export const MAX_DAYBELL_FEE_BPS = 2000;

const wholeCents = (n: number) => {
  if (!Number.isSafeInteger(n) || n < 0) throw new Error("Money must be a whole number of cents");
  return n;
};

/**
 * Daybell's fee on an order: the products' value (never tax or shipping, D59) times the rate in basis points, rounded
 * half up to the cent (call 16). Integers only.
 */
export function daybellFeeCents(productsCents: number, basisPoints: number): number {
  wholeCents(productsCents);
  if (!Number.isInteger(basisPoints) || basisPoints < 0 || basisPoints > MAX_DAYBELL_FEE_BPS)
    throw new Error("The fee is 0 to 2000 basis points");
  return Math.floor((productsCents * basisPoints + 5000) / 10000);
}

/** The smallest charge Stripe takes (call 13: refused below it, with "Minimum order is $0.50"; no free orders). */
export const MIN_CHARGE_CENTS: Record<Currency, number> = { CAD: 50, USD: 50 };

// ── The ledger (ADR 0006, amended by ADR 0023) ────────────────────────────────────────────────────────────────────

export type OrderLedgerAccount =
  | "parent_payments"
  | "tax_payable"
  | "daybell_fees"
  | "payment_fees"
  | "studio_payable";

export interface OrderLedgerLine {
  account: OrderLedgerAccount;
  /** Positive is a debit (money in hand or receivable), negative a credit (owed or earned). */
  cents: number;
}

export interface PaidOrderAmounts {
  /** What the parent paid: products, shipping and tax. */
  totalCents: number;
  taxCents: number;
  daybellFeeCents: number;
  /** Stripe's actual fee for the charge, recovered from the studio (call 1, D98). */
  stripeFeeCents: number;
}

/**
 * A paid order's one ledger transaction: the payment, the tax the studio owes, Daybell's fee, Stripe's fee and the
 * studio's share, summing to zero. Zero lines are left out (the ledger refuses them).
 */
export function orderLedger(order: PaidOrderAmounts): OrderLedgerLine[] {
  const total = wholeCents(order.totalCents);
  const tax = wholeCents(order.taxCents);
  const daybell = wholeCents(order.daybellFeeCents);
  const stripe = wholeCents(order.stripeFeeCents);
  const lines: OrderLedgerLine[] = [
    { account: "parent_payments", cents: total },
    { account: "tax_payable", cents: -tax },
    { account: "daybell_fees", cents: -daybell },
    { account: "payment_fees", cents: -stripe },
    { account: "studio_payable", cents: -(total - tax - daybell - stripe) },
  ];
  return lines.filter((l) => l.cents !== 0);
}

/**
 * What reaches the studio's Stripe balance for a paid order: the total less Daybell's fee (the application fee) and
 * Stripe's fee (the transfer reversal). It includes the tax, which the studio remits (D106).
 */
export function studioReceivesCents(order: PaidOrderAmounts): number {
  return order.totalCents - order.daybellFeeCents - order.stripeFeeCents;
}

// ── The card statement (D104; call 7) ───────────────────────────────────────────────────────────────────────────

/** The prefix Daybell sets on each studio's Stripe account: the statement reads "DBL* RIVERSIDE PHOTO". */
export const CARD_PREFIX = "DBL";
/** A card statement descriptor's length, prefix and suffix together (Stripe's limit, unverified: ADR 0023). */
export const STATEMENT_DESCRIPTOR_MAX = 22;
/** Stripe joins the two with "* ". */
const JOINER = 2;

/**
 * The per-charge suffix from the studio's name (call 7): upper-case Latin letters, digits and single spaces, accents
 * dropped (É → E), anything else removed (Stripe refuses < > \ ' " * in descriptors), cut to fit 22 characters with
 * the prefix, at a word where it can. Null when nothing with a letter is left (the account's own descriptor applies).
 */
export function statementSuffix(studioName: string): string | null {
  const room = STATEMENT_DESCRIPTOR_MAX - CARD_PREFIX.length - JOINER;
  const plain = studioName
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/&/g, " AND ")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  let cut = plain.slice(0, room).trim();
  if (plain.length > room) {
    const space = cut.lastIndexOf(" ");
    // At a word, unless that would leave too little (a long first word is cut where it falls).
    if (space >= 5) cut = cut.slice(0, space);
  }
  return /[A-Z]/.test(cut) ? cut : null;
}

// ── References ──────────────────────────────────────────────────────────────────────────────────────────────────

/** 8 characters of Crockford's base32 (no I, L, O or U), made by the database. */
export const ORDER_REFERENCE = /^[0-9A-HJKMNP-TV-Z]{8}$/;

export function isOrderReference(text: string): boolean {
  return ORDER_REFERENCE.test(text);
}

/** As people read it: "7KQ2-M9XA". */
export function formatOrderReference(reference: string): string {
  return isOrderReference(reference) ? `${reference.slice(0, 4)}-${reference.slice(4)}` : reference;
}

// ── Checkout from the bag ───────────────────────────────────────────────────────────────────────────────────────

/** Why the bag can't be paid for yet; the Pay button says so instead (ADR 0023 §6). */
export type CheckoutBlocker = "empty" | "unavailable" | "chooseDelivery" | "belowMinimum";

export interface CheckoutBagFacts {
  lines: readonly { available: boolean }[];
  /** Subtotal plus delivery before tax; null while delivery is still to be chosen (core cartTotals). */
  totalCents: number | null;
  currency: Currency;
}

/** What stops paying for a bag, in the order the parent fixes them; null when it can be paid for. */
export function checkoutBlocker(bag: CheckoutBagFacts): CheckoutBlocker | null {
  if (bag.lines.length === 0) return "empty";
  if (bag.lines.some((l) => !l.available)) return "unavailable";
  if (bag.totalCents === null) return "chooseDelivery";
  if (bag.totalCents < MIN_CHARGE_CENTS[bag.currency]) return "belowMinimum";
  return null;
}

/**
 * Whether a line sold unlocks downloads once paid (calls 9, 10): a single download, "all digitals", or a package holding
 * a digital (its one pose). Prints never do.
 */
export function unlocksDownloads(
  kind: PriceItemKind,
  contents: readonly { kind: PackageLineKind }[] = [],
): boolean {
  if (kind === "digital_single" || kind === "digital_all") return true;
  return kind === "package" && contents.some((c) => c.kind === "digital");
}

/** How long a download link lasts: 5 minutes, signed again on each tap (ADR 0023). */
export const DOWNLOAD_LINK_SECONDS = 300;

/** A download's file name: the order's reference and the photo's number in it, never a name (ADR 0023). */
export function downloadFileName(reference: string, n: number): string {
  if (!isOrderReference(reference) || !Number.isInteger(n) || n < 1)
    throw new Error("A download is named by its order and number");
  return `silverback-${reference}-${n}.jpg`;
}

/** Stripe's hosted checkout lasts 30 minutes, its shortest (Stripe's documented minimum; ADR 0023). */
export const CHECKOUT_MINUTES = 30;

// ── Zips (Phase 1 step 11; ADR 0024) ────────────────────────────────────────────────────────────────────────────

/** At most this many files in one zip (Claude's call). */
export const MAX_ZIP_FILES = 500;

/** A zip's name: the order's reference only, never a child's name. */
export function zipFileName(reference: string, kind: "downloads" | "print-files"): string {
  if (!isOrderReference(reference)) throw new Error("A zip is named by its order");
  return kind === "downloads"
    ? `silverback-${reference}.zip`
    : `silverback-${reference}-print-files.zip`;
}

/** An entry of "Download all": the same name the single download is saved under. */
export const zipEntryName = downloadFileName;

/**
 * A print file's name: the reference, the line's position, its size (or "package") and how many to print, e.g.
 * "7KQ2M9XA-2-5x7-x2.jpg". Never a name.
 */
export function printFileName(
  reference: string,
  position: number,
  size: string | null,
  quantity: number,
): string {
  if (
    !isOrderReference(reference) ||
    !Number.isInteger(position) ||
    position < 1 ||
    !Number.isInteger(quantity) ||
    quantity < 1
  )
    throw new Error("A print file is named by its order, line and quantity");
  const label = (size ?? "package").replace(/[^A-Za-z0-9_]/g, "");
  return `${reference}-${position}-${label}-x${quantity}.jpg`;
}

/** One line of the print files' manifest. */
export interface PrintManifestRow {
  file: string | null;
  position: number;
  item: string;
  size: string | null;
  quantity: number;
  /** A package's prints, e.g. "8x10 x1; 5x7 x2". */
  contents: string;
}

const csvCell = (value: string | number | null): string => {
  const text = value === null ? "" : String(value);
  // Spreadsheet formulas are never started by a cell (=, +, -, @), and quotes are doubled.
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
};

/** The manifest.csv in the print files' zip: what to print, with no names. */
export function printManifest(rows: readonly PrintManifestRow[]): string {
  const header = ["file", "line", "item", "size", "quantity", "contents"];
  const lines = rows.map((r) =>
    [r.file ?? "missing", r.position, r.item, r.size, r.quantity, r.contents]
      .map(csvCell)
      .join(","),
  );
  return `${[header.join(","), ...lines].join("\r\n")}\r\n`;
}
