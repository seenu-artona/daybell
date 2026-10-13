import { describe, expect, it } from "vitest";
import {
  campaignsMaySend,
  closingDateAllowed,
  closingDay,
  daysUntil,
  endOfLocalDay,
  localDay,
  MAX_CLOSING_DAYS,
  qrCardsDone,
  SELL_BLOCKER_DB_KEYS,
  SELL_CHECKLIST,
  type SellFacts,
  sellBlockers,
  sellBlockersFromDb,
  sellChecklist,
} from "./job-page";
import { JOB_STATUSES } from "./jobs";

describe("qrCardsDone", () => {
  it("is done when every child who may be photographed has a card, and never for an empty roster", () => {
    expect(qrCardsDone({ eligible: 9, withCard: 9 }, 10)).toBe(true);
    // A child added after printing reopens it.
    expect(qrCardsDone({ eligible: 10, withCard: 9 }, 10)).toBe(false);
    expect(qrCardsDone(null, 10)).toBe(false);
    expect(qrCardsDone(undefined, 10)).toBe(false);
    // Every child marked Do not photograph: nothing to print.
    expect(qrCardsDone({ eligible: 0, withCard: 0 }, 3)).toBe(true);
    expect(qrCardsDone({ eligible: 0, withCard: 0 }, 0)).toBe(false);
  });
});

describe("sellChecklist and sellBlockers (ADR 0021, call 1, A1, A2)", () => {
  const none: SellFacts = {
    children: 0,
    hasReadyPhoto: false,
    taggingReviewed: false,
    hasPriceList: false,
    payoutsConnected: false,
  };
  const all: SellFacts = {
    children: 4,
    hasReadyPhoto: true,
    taggingReviewed: true,
    hasPriceList: true,
    payoutsConnected: true,
  };

  it("lists the five items in order, every one real (no more Coming soon)", () => {
    expect(sellChecklist(none)).toEqual(SELL_CHECKLIST.map((key) => ({ key, done: false })));
    expect(sellChecklist(all).every((i) => i.done)).toBe(true);
    expect(sellChecklist({ ...none, hasReadyPhoto: true }).find((i) => i.key === "photos")).toEqual(
      {
        key: "photos",
        done: true,
      },
    );
  });

  it("blocks on exactly the items not done, for every combination, in the dialog's order", () => {
    const keys = Object.keys(all) as (keyof SellFacts)[];
    for (let mask = 0; mask < 1 << keys.length; mask++) {
      const f = { ...all };
      keys.forEach((k, i) => {
        if (mask & (1 << i)) (f as Record<string, unknown>)[k] = k === "children" ? 0 : false;
      });
      const blockers = sellBlockers(f);
      expect(blockers).toEqual(
        sellChecklist(f)
          .filter((i) => !i.done)
          .map((i) => i.key),
      );
      expect(blockers.length).toBe(keys.filter((_, i) => mask & (1 << i)).length);
    }
    expect(sellBlockers(all)).toEqual([]);
    expect(sellBlockers(none)).toEqual([...SELL_CHECKLIST]);
  });

  it("reads the database's blocker keys, ignoring anything it doesn't know", () => {
    expect(sellBlockersFromDb("payouts,price_list,roster")).toEqual([
      "roster",
      "priceList",
      "payouts",
    ]);
    expect(sellBlockersFromDb("photos, tagging")).toEqual(["photos", "tagging"]);
    expect(sellBlockersFromDb("priceList,<script>,Maya")).toEqual([]);
    expect(sellBlockersFromDb("")).toEqual([]);
    expect(sellBlockersFromDb(null)).toEqual([]);
    expect(Object.values(SELL_BLOCKER_DB_KEYS)).toEqual([
      "roster",
      "photos",
      "tagging",
      "price_list",
      "payouts",
    ]);
  });
});

describe("campaignsMaySend (D47)", () => {
  it("allows campaigns only while a job is selling, as GotPhoto", () => {
    expect(JOB_STATUSES.map(campaignsMaySend)).toEqual([false, true, false]);
  });
});

describe("closingDateAllowed", () => {
  const now = new Date("2026-10-12T12:00:00Z");
  it("takes a moment in the future, at most 400 days away", () => {
    expect(closingDateAllowed(new Date("2026-10-12T12:00:01Z"), now)).toBe(true);
    expect(closingDateAllowed(new Date(now.getTime() + MAX_CLOSING_DAYS * 86_400_000), now)).toBe(
      true,
    );
    expect(
      closingDateAllowed(new Date(now.getTime() + MAX_CLOSING_DAYS * 86_400_000 + 1), now),
    ).toBe(false);
    expect(closingDateAllowed(now, now)).toBe(false);
    expect(closingDateAllowed(new Date("2026-10-01T00:00:00Z"), now)).toBe(false);
    expect(closingDateAllowed(new Date("nonsense"), now)).toBe(false);
  });
});

describe("endOfLocalDay and closingDay (ADR 0021, Q2)", () => {
  // Time zones are passed explicitly: switching process TZ at run time is not reliable across Node builds.
  // America/Los_Angeles, not Vancouver: newer tz data may give British Columbia year-round UTC−7,
  // so a Vancouver expectation would depend on the runner's ICU version.
  it("is the next local midnight, in the setter's own time zone", () => {
    expect(endOfLocalDay("2026-11-20", "America/Toronto").toISOString()).toBe(
      "2026-11-21T05:00:00.000Z",
    );
    expect(endOfLocalDay("2026-11-20", "America/Los_Angeles").toISOString()).toBe(
      "2026-11-21T08:00:00.000Z",
    );
  });

  it("handles daylight saving days and month and year ends", () => {
    const tz = "America/Toronto";
    // Clocks go back on Nov 1, 2026.
    expect(endOfLocalDay("2026-10-31", tz).toISOString()).toBe("2026-11-01T04:00:00.000Z");
    expect(endOfLocalDay("2026-11-01", tz).toISOString()).toBe("2026-11-02T05:00:00.000Z");
    // Clocks go forward on Mar 14, 2027.
    expect(endOfLocalDay("2027-03-14", tz).toISOString()).toBe("2027-03-15T04:00:00.000Z");
    expect(endOfLocalDay("2026-12-31", tz).toISOString()).toBe("2027-01-01T05:00:00.000Z");
  });

  it("gives back the chosen day for the date field", () => {
    for (const tz of ["America/Toronto", "America/Vancouver", "America/Halifax"]) {
      for (const day of ["2026-10-31", "2026-11-01", "2027-03-14", "2027-02-28"])
        expect(closingDay(endOfLocalDay(day, tz), tz)).toBe(day);
      expect(closingDay(endOfLocalDay("2026-11-20", tz).toISOString(), tz)).toBe("2026-11-20");
    }
  });

  it("uses the runtime's own zone when none is given", () => {
    for (const day of ["2026-10-31", "2026-11-20", "2027-03-14"])
      expect(closingDay(endOfLocalDay(day))).toBe(day);
  });
});

describe("daysUntil", () => {
  it("counts whole calendar days, across months and years", () => {
    expect(daysUntil("2026-10-14", "2026-10-14")).toBe(0);
    expect(daysUntil("2026-10-15", "2026-10-14")).toBe(1);
    expect(daysUntil("2026-10-13", "2026-10-14")).toBe(-1);
    expect(daysUntil("2026-11-01", "2026-10-31")).toBe(1);
    expect(daysUntil("2027-01-01", "2026-12-31")).toBe(1);
    expect(daysUntil("2026-12-31", "2027-01-01")).toBe(-1);
    expect(daysUntil("2028-03-01", "2028-02-28")).toBe(2);
  });

  it("ignores daylight saving changes (calendar dates, not hours)", () => {
    expect(daysUntil("2026-11-02", "2026-10-31")).toBe(2);
    expect(daysUntil("2027-03-15", "2027-03-13")).toBe(2);
  });
});

describe("localDay", () => {
  it("is the local calendar date, zero-padded", () => {
    expect(localDay(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDay(new Date(2026, 11, 31, 0, 0))).toBe("2026-12-31");
    expect(localDay(new Date(2027, 0, 1, 0, 0))).toBe("2027-01-01");
  });
});
