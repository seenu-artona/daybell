import { JOB_CONFLICTS, SELL_BLOCKER_FIELDS } from "@daybell/api";
import { SELL_CHECKLIST, type SellChecklistKey, sellChecklist } from "@daybell/core";

/**
 * The job header's going-live rules (ADR 0021), kept free of React so they are unit tested: what each "Before you can
 * sell" row says, what a refusal means, and which actions the header offers.
 */

export type SellItemState = "done" | "todo" | "checking";

export interface SellItemFacts {
  children: number;
  hasReadyPhoto: boolean;
  taggingReviewed: boolean;
  /** The job's price list has an item; undefined while it is being checked. */
  hasPriceList: boolean | undefined;
  /** The studio's payout account is Active; undefined while it is being checked. */
  payoutsConnected: boolean | undefined;
}

/**
 * Each row's state. After the server refused (409 notReady), its list wins: what it named is to do, the rest done
 * (call 1: the server checks everything, atomically).
 */
export function sellItems(
  facts: SellItemFacts,
  blockers: readonly SellChecklistKey[] | null,
): { key: SellChecklistKey; state: SellItemState }[] {
  if (blockers)
    return SELL_CHECKLIST.map((key) => ({ key, state: blockers.includes(key) ? "todo" : "done" }));
  const checking: Partial<Record<SellChecklistKey, boolean>> = {
    priceList: facts.hasPriceList === undefined,
    payouts: facts.payoutsConnected === undefined,
  };
  return sellChecklist({
    ...facts,
    hasPriceList: facts.hasPriceList === true,
    payoutsConnected: facts.payoutsConnected === true,
  }).map(({ key, done }) => ({ key, state: checking[key] ? "checking" : done ? "done" : "todo" }));
}

/** Whether the person may press Start selling (or Reopen shop) now: every row done. */
export function readyToSell(items: readonly { state: SellItemState }[]): boolean {
  return items.every((item) => item.state === "done");
}

/** The missing items a 409 notReady named in its fields; only known keys with their own message keys count. */
export function blockersFromFields(fields: Record<string, string>): SellChecklistKey[] {
  return SELL_CHECKLIST.filter((key) => fields[key] === SELL_BLOCKER_FIELDS[key]);
}

const CONFLICT_KEYS = Object.keys(JOB_CONFLICTS) as (keyof typeof JOB_CONFLICTS)[];
export type JobConflictKey = (typeof CONFLICT_KEYS)[number];

/** A job conflict's key (JOB_CONFLICTS), without the "jobs." prefix, or null for anything else. */
export function jobConflictKey(form: string | undefined): JobConflictKey | null {
  return CONFLICT_KEYS.find((key) => JOB_CONFLICTS[key] === form) ?? null;
}

/** What the header's main pill does for this job: open the go-live dialog, close the shop, or reopen it. */
export function shopAction(status: "draft" | "selling" | "closed"): "start" | "close" | "reopen" {
  return status === "draft" ? "start" : status === "selling" ? "close" : "reopen";
}
