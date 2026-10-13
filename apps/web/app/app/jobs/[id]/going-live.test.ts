import { describe, expect, it } from "vitest";
import {
  blockersFromFields,
  closingDatePassed,
  jobConflictKey,
  readyToSell,
  sellItems,
  shopAction,
  shopChangedElsewhere,
} from "./going-live";

const ready = {
  children: 2,
  hasReadyPhoto: true,
  taggingReviewed: true,
  hasPriceList: true,
  payoutsConnected: true,
};

describe("sellItems", () => {
  it("says Checking… for the price list and payouts until they are read", () => {
    const items = sellItems(
      { ...ready, hasPriceList: undefined, payoutsConnected: undefined },
      null,
    );
    expect(items.map((i) => i.state)).toEqual(["done", "done", "done", "checking", "checking"]);
    expect(readyToSell(items)).toBe(false);
  });

  it("says Checking… for the roster and photos until the job's summary arrives, never To do (S4)", () => {
    const items = sellItems({ ...ready, children: undefined, hasReadyPhoto: undefined }, null);
    expect(items.map((i) => [i.key, i.state])).toEqual([
      ["roster", "checking"],
      ["photos", "checking"],
      ["tagging", "done"],
      ["priceList", "done"],
      ["payouts", "done"],
    ]);
    expect(readyToSell(items)).toBe(false);
    expect(sellItems({ ...ready, children: 0 }, null)[0]?.state).toBe("todo");
  });

  it("is ready only when all five are done; photos are real now (A1)", () => {
    expect(readyToSell(sellItems(ready, null))).toBe(true);
    const noPhotos = sellItems({ ...ready, hasReadyPhoto: false }, null);
    expect(noPhotos.find((i) => i.key === "photos")?.state).toBe("todo");
    expect(readyToSell(noPhotos)).toBe(false);
    expect(readyToSell(sellItems({ ...ready, hasPriceList: false }, null))).toBe(false);
  });

  it("lets the server's refusal win", () => {
    const items = sellItems(ready, ["tagging", "payouts"]);
    expect(items.map((i) => [i.key, i.state])).toEqual([
      ["roster", "done"],
      ["photos", "done"],
      ["tagging", "todo"],
      ["priceList", "done"],
      ["payouts", "todo"],
    ]);
  });
});

describe("blockersFromFields and jobConflictKey", () => {
  it("reads only known items with their own message keys", () => {
    expect(
      blockersFromFields({
        form: "jobs.notReady",
        photos: "jobs.sell.photos",
        tagging: "jobs.sell.tagging",
        payouts: "something else",
        name: "jobs.sell.roster",
      }),
    ).toEqual(["photos", "tagging"]);
    expect(blockersFromFields({})).toEqual([]);
  });

  it("names job conflicts and nothing else", () => {
    expect(jobConflictKey("jobs.notReady")).toBe("notReady");
    expect(jobConflictKey("jobs.closed")).toBe("closed");
    expect(jobConflictKey("jobs.closesAtPassed")).toBe("closesAtPassed");
    expect(jobConflictKey("priceLists.jobClosed")).toBeNull();
    expect(jobConflictKey(undefined)).toBeNull();
  });
});

describe("shopAction", () => {
  it("starts a draft, closes a selling shop and reopens a closed one (never back to draft)", () => {
    expect(shopAction("draft")).toBe("start");
    expect(shopAction("selling")).toBe("close");
    expect(shopAction("closed")).toBe("reopen");
  });
});

describe("shopChangedElsewhere", () => {
  it("reloads the job when the shop's state moved on, not when the job just isn't ready (S1)", () => {
    for (const key of ["alreadySelling", "notSelling", "notClosed", "closed"] as const)
      expect(shopChangedElsewhere(key)).toBe(true);
    for (const key of ["notReady", "closesAtPassed", null] as const)
      expect(shopChangedElsewhere(key)).toBe(false);
  });
});

describe("closingDatePassed", () => {
  const now = Date.parse("2026-10-12T12:00:00Z");
  it("is true only for a draft whose closing date has gone by", () => {
    expect(closingDatePassed({ status: "draft", closesAt: "2026-10-12T11:59:59Z" }, now)).toBe(
      true,
    );
    expect(closingDatePassed({ status: "draft", closesAt: "2026-10-12T12:00:00Z" }, now)).toBe(
      true,
    );
    expect(closingDatePassed({ status: "draft", closesAt: "2026-10-13T00:00:00Z" }, now)).toBe(
      false,
    );
    expect(closingDatePassed({ status: "draft", closesAt: null }, now)).toBe(false);
    expect(closingDatePassed({ status: "selling", closesAt: "2026-10-01T00:00:00Z" }, now)).toBe(
      false,
    );
  });
});
