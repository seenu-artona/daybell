import { describe, expect, it } from "vitest";
import { daysUntil, localDay, qrCardsDone, sellChecklist } from "./job-page";

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

describe("sellChecklist", () => {
  it("marks the roster and reviewed tagging done; the rest are coming soon (ADR 0018)", () => {
    expect(sellChecklist({ children: 0, taggingReviewed: false }).filter((i) => i.done)).toEqual(
      [],
    );
    const items = sellChecklist({ children: 4, taggingReviewed: true });
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(["roster", "tagging"]);
    expect(items.filter((i) => i.soon).map((i) => i.key)).toEqual([
      "photos",
      "priceList",
      "payouts",
    ]);
    expect(items.every((i) => !(i.done && i.soon))).toBe(true);
    expect(
      sellChecklist({ children: 4, taggingReviewed: false }).find((i) => i.key === "tagging"),
    ).toEqual({ key: "tagging", done: false, soon: false });
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
