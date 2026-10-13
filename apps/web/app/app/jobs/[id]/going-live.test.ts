import { describe, expect, it } from "vitest";
import {
  blockersFromFields,
  jobConflictKey,
  readyToSell,
  sellItems,
  shopAction,
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
