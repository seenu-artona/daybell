/**
 * Job › Shop (D157; Seenu's answers B1, B2, N4 of Oct 14, 2026; ADR 0033). A job sells its price list's items with its
 * own changes on top, and products only it sells. A change is the job's own price for a list item, or the item switched
 * off; the shared list never changes. The database resolves every price the same way (app.job_offer in
 * packages/db migration 20261017000000_job_shop.sql); these are the rules the screens and the API use.
 */
import { MAX_ITEM_PRICE_CENTS, type PriceItemKind } from "./price-lists";

/** Products a job can add for itself (B2): packages and prints. Downloads stay one per list. */
export const JOB_ITEM_KINDS = ["package", "print"] as const;
export type JobItemKind = (typeof JOB_ITEM_KINDS)[number];

/** At most 100 products of its own per job (B2); the database checks it too. */
export const MAX_JOB_ITEMS = 100;

export function isJobItemKind(kind: PriceItemKind): kind is JobItemKind {
  return (JOB_ITEM_KINDS as readonly string[]).includes(kind);
}

/** Where a row of Job › Shop comes from: the job's price list, or the job itself (the Price list column shows —). */
export type JobShopSource = "list" | "job";

export interface JobShopRowFacts {
  source: JobShopSource;
  /** The list's price; null for a product only this job sells. */
  listPriceCents: number | null;
  /** What this job sells it for. */
  priceCents: number;
  sold: boolean;
}

/** This job's price: its own when it has one, else the list's (Shopify's pattern, Seenu). */
export function jobPriceCents(listPriceCents: number, ownPriceCents: number | null): number {
  return ownPriceCents ?? listPriceCents;
}

/**
 * What to save when a price is typed for a list item (D157: "type the list price back to undo"): null clears the
 * job's own price (the list's applies again), otherwise the typed price.
 */
export function ownPriceFor(listPriceCents: number, typedCents: number): number | null {
  if (!Number.isSafeInteger(typedCents)) throw new Error("Money must be a whole number of cents");
  return typedCents === listPriceCents ? null : typedCents;
}

/** Whether a typed price is one a job may sell at: whole cents, $0 to $10,000 (ADR 0019 call 8). */
export function isJobPrice(cents: number): boolean {
  return Number.isSafeInteger(cents) && cents >= 0 && cents <= MAX_ITEM_PRICE_CENTS;
}

/**
 * Whether a row is a change for this job (N1): a price other than the list's, an item switched off (even at the list's
 * price), or a product only this job sells.
 */
export function isJobChange(row: JobShopRowFacts): boolean {
  return row.source === "job" || row.priceCents !== row.listPriceCents || !row.sold;
}

/** "N changes for this job" (D157; N1). */
export function countJobChanges(rows: readonly JobShopRowFacts[]): number {
  return rows.filter(isJobChange).length;
}

/** Whether the job sells anything at all (N3: Start selling's "Price list chosen"). */
export function sellsSomething(rows: readonly Pick<JobShopRowFacts, "sold">[]): boolean {
  return rows.some((row) => row.sold);
}

/**
 * The changes a list swap drops (B1): the job's own prices and Sold switches on the old list. Products only this
 * job sells stay with the job.
 */
export function changesDroppedBySwap(rows: readonly JobShopRowFacts[]): number {
  return rows.filter((row) => row.source === "list" && isJobChange(row)).length;
}
