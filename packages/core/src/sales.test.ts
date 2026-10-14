import { describe, expect, it } from "vitest";
import { averageOrderCents, salesRanges, zonedMidnight } from "./sales";

describe("Home's ranges (D127)", () => {
  it("start at local midnight today, on Monday and on August 1", () => {
    // Tuesday Oct 13, 2026, 10:00 in Toronto (EDT, UTC−4).
    const r = salesRanges(new Date("2026-10-13T14:00:00Z"), "America/Toronto");
    expect(r.today.toISOString()).toBe("2026-10-13T04:00:00.000Z");
    expect(r.week.toISOString()).toBe("2026-10-12T04:00:00.000Z");
    expect(r.season.toISOString()).toBe("2026-08-01T04:00:00.000Z");
  });

  it("is right across the end of daylight time", () => {
    // Tuesday Nov 3, 2026 in Toronto: EST (UTC−5) now, but Monday Nov 2 began in EST and Aug 1 in EDT.
    const r = salesRanges(new Date("2026-11-03T15:00:00Z"), "America/Toronto");
    expect(r.today.toISOString()).toBe("2026-11-03T05:00:00.000Z");
    expect(r.week.toISOString()).toBe("2026-11-02T05:00:00.000Z");
    expect(r.season.toISOString()).toBe("2026-08-01T04:00:00.000Z");
    // Sunday Nov 1, the day the clocks go back: its week began Monday Oct 26 in EDT.
    const sunday = salesRanges(new Date("2026-11-01T18:00:00Z"), "America/Toronto");
    expect(sunday.week.toISOString()).toBe("2026-10-26T04:00:00.000Z");
    expect(sunday.today.toISOString()).toBe("2026-11-01T04:00:00.000Z");
  });

  it("starts the season the August before, until August comes", () => {
    const r = salesRanges(new Date("2027-03-15T12:00:00Z"), "America/Vancouver");
    expect(r.season.toISOString()).toBe("2026-08-01T07:00:00.000Z");
  });

  it("counts in the person's day, not UTC's", () => {
    // 01:30 UTC on Oct 14 is still Oct 13 in Vancouver.
    const r = salesRanges(new Date("2026-10-14T01:30:00Z"), "America/Vancouver");
    expect(r.today.toISOString()).toBe("2026-10-13T07:00:00.000Z");
    expect(zonedMidnight(2026, 3, 8, "America/Toronto").toISOString()).toBe(
      "2026-03-08T05:00:00.000Z",
    );
  });
});

describe("averageOrderCents", () => {
  it("is whole cents, half up, and nothing without orders", () => {
    expect(averageOrderCents(10_001, 2)).toBe(5001);
    expect(averageOrderCents(10_000, 3)).toBe(3333);
    expect(averageOrderCents(0, 0)).toBeNull();
    expect(averageOrderCents(-300, 2)).toBe(-150);
  });
});
