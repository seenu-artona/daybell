import { describe, expect, it } from "vitest";
import {
  changesDroppedBySwap,
  countJobChanges,
  isJobChange,
  isJobItemKind,
  isJobPrice,
  JOB_ITEM_KINDS,
  type JobShopRowFacts,
  jobPriceCents,
  MAX_JOB_ITEMS,
  ownPriceFor,
  sellsSomething,
} from "./job-shop";

const list = (
  listPriceCents: number,
  priceCents = listPriceCents,
  sold = true,
): JobShopRowFacts => ({
  source: "list",
  listPriceCents,
  priceCents,
  sold,
});
const own = (priceCents: number, sold = true): JobShopRowFacts => ({
  source: "job",
  listPriceCents: null,
  priceCents,
  sold,
});

describe("this job's price (D157; ADR 0033)", () => {
  it("is the job's own when it has one, else the list's", () => {
    expect(jobPriceCents(6400, 7000)).toBe(7000);
    expect(jobPriceCents(6400, null)).toBe(6400);
    expect(jobPriceCents(6400, 0)).toBe(0);
  });

  it("typing the list's price back clears the job's own (undo), anything else is kept", () => {
    expect(ownPriceFor(6400, 6400)).toBeNull();
    expect(ownPriceFor(6400, 7000)).toBe(7000);
    expect(ownPriceFor(6400, 0)).toBe(0);
    expect(() => ownPriceFor(6400, 64.5)).toThrow();
  });

  it("is whole cents from $0 to $10,000", () => {
    expect(isJobPrice(0)).toBe(true);
    expect(isJobPrice(1_000_000)).toBe(true);
    expect(isJobPrice(1_000_001)).toBe(false);
    expect(isJobPrice(-1)).toBe(false);
    expect(isJobPrice(12.5)).toBe(false);
  });
});

describe("N changes for this job (N1)", () => {
  it("counts changed prices, items switched off (even at the list's price) and the job's own products", () => {
    expect(isJobChange(list(6400))).toBe(false);
    expect(isJobChange(list(6400, 7000))).toBe(true);
    expect(isJobChange(list(6400, 6400, false))).toBe(true);
    expect(isJobChange(own(4500))).toBe(true);
    expect(
      countJobChanges([list(6400), list(6400, 7000), list(1000, 1000, false), own(4500)]),
    ).toBe(3);
    expect(countJobChanges([])).toBe(0);
  });

  it("a swap drops the list's changes, never the job's own products (B1)", () => {
    expect(
      changesDroppedBySwap([list(6400, 7000), list(1000, 1000, false), list(10), own(4500)]),
    ).toBe(2);
  });
});

describe("what a job may add and sell", () => {
  it("adds packages and prints only, at most 100 (B2)", () => {
    expect(JOB_ITEM_KINDS).toEqual(["package", "print"]);
    expect(isJobItemKind("package")).toBe(true);
    expect(isJobItemKind("print")).toBe(true);
    expect(isJobItemKind("digital_single")).toBe(false);
    expect(isJobItemKind("digital_all")).toBe(false);
    expect(MAX_JOB_ITEMS).toBe(100);
  });

  it("sells something when any row is sold (N3)", () => {
    expect(sellsSomething([list(10, 10, false), own(5, false)])).toBe(false);
    expect(sellsSomething([list(10, 10, false), own(5)])).toBe(true);
    expect(sellsSomething([])).toBe(false);
  });
});
