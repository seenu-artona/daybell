import { describe, expect, it } from "vitest";
import { closingWeekEnd, monthRange } from "./job-list-filters";

// The Jobs list's "Show only" bounds (D147, ADR 0026), from the viewer's day.
describe("closingWeekEnd", () => {
  it("ends after the seventh day counting today, wherever in the US or Canada the shop's day ended", () => {
    const end = closingWeekEnd("2026-10-14");
    expect(end).toBe("2026-10-21T10:00:00.000Z");
    // The end of Oct 20 (today + 6) in Hawaii, Pacific, Eastern and Newfoundland time is within the week…
    for (const at of [
      "2026-10-21T10:00:00Z",
      "2026-10-21T07:00:00Z",
      "2026-10-21T04:00:00Z",
      "2026-10-21T02:30:00Z",
    ])
      expect(Date.parse(at)).toBeLessThanOrEqual(Date.parse(end));
    // …and the end of Oct 21 (today + 7) anywhere there is not.
    for (const at of ["2026-10-22T02:30:00Z", "2026-10-22T04:00:00Z", "2026-10-22T10:00:00Z"])
      expect(Date.parse(at)).toBeGreaterThan(Date.parse(end));
  });

  it("crosses months and years", () => {
    expect(closingWeekEnd("2026-12-28")).toBe("2027-01-04T10:00:00.000Z");
  });
});

describe("monthRange", () => {
  it("is today's calendar month", () => {
    expect(monthRange("2026-10-14")).toEqual({ from: "2026-10-01", before: "2026-11-01" });
    expect(monthRange("2026-12-31")).toEqual({ from: "2026-12-01", before: "2027-01-01" });
    expect(monthRange("2027-02-01")).toEqual({ from: "2027-02-01", before: "2027-03-01" });
  });
});
