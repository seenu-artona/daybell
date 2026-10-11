import { describe, expect, it } from "vitest";
import {
  daysUntil,
  JOURNEY_STAGES,
  type JobFacts,
  jobStage,
  localDay,
  nextStep,
  sellChecklist,
} from "./job-page";
import { JOB_STATUSES } from "./jobs";

const draft = (over: Partial<JobFacts> = {}): JobFacts => ({
  status: "draft",
  pictureDay: "2026-10-14",
  children: 0,
  today: "2026-10-11",
  ...over,
});

describe("jobStage", () => {
  it("is set up while a draft has no roster, whatever the date", () => {
    expect(jobStage(draft())).toBe("setUp");
    expect(jobStage(draft({ today: "2026-10-14" }))).toBe("setUp");
    expect(jobStage(draft({ today: "2027-01-01" }))).toBe("setUp");
  });

  it("is set up with a roster before picture day, and picture day from that day on", () => {
    expect(jobStage(draft({ children: 3, today: "2026-10-13" }))).toBe("setUp");
    expect(jobStage(draft({ children: 3, today: "2026-10-14" }))).toBe("pictureDay");
    expect(jobStage(draft({ children: 3, today: "2026-12-01" }))).toBe("pictureDay");
  });

  it("follows the job's status once it sells or closes", () => {
    expect(jobStage(draft({ status: "selling" }))).toBe("selling");
    expect(jobStage(draft({ status: "selling", children: 9 }))).toBe("selling");
    expect(jobStage(draft({ status: "closed", children: 9 }))).toBe("closed");
  });

  it("never returns stages whose data doesn't exist yet (review photos, fulfilment)", () => {
    const seen = new Set<string>();
    for (const status of JOB_STATUSES)
      for (const children of [0, 1, 500])
        for (const today of ["2020-01-01", "2026-10-14", "2030-12-31"])
          seen.add(jobStage(draft({ status, children, today })));
    expect(seen).not.toContain("reviewPhotos");
    expect(seen).not.toContain("fulfilment");
    for (const stage of seen) expect(JOURNEY_STAGES).toContain(stage);
  });
});

describe("nextStep", () => {
  it("asks for the roster first", () => {
    expect(nextStep(draft())).toEqual({ key: "addRoster" });
    expect(nextStep(draft({ today: "2026-11-01" }))).toEqual({ key: "addRoster" });
  });

  it("then says to get ready for picture day, with the date", () => {
    expect(nextStep(draft({ children: 2 }))).toEqual({ key: "getReady", pictureDay: "2026-10-14" });
  });

  it("then points at uploading photos, which is coming soon", () => {
    expect(nextStep(draft({ children: 2, today: "2026-10-14" }))).toEqual({
      key: "uploadPhotos",
      soon: true,
    });
  });

  it("has nothing once the job sells or closes", () => {
    expect(nextStep(draft({ status: "selling", children: 2 }))).toBeNull();
    expect(nextStep(draft({ status: "closed" }))).toBeNull();
  });
});

describe("sellChecklist", () => {
  it("only ever marks the roster done; the rest are coming soon", () => {
    expect(sellChecklist({ children: 0 }).filter((i) => i.done)).toEqual([]);
    const items = sellChecklist({ children: 4 });
    expect(items.filter((i) => i.done).map((i) => i.key)).toEqual(["roster"]);
    expect(items.filter((i) => i.soon).map((i) => i.key)).toEqual([
      "photos",
      "tagging",
      "priceList",
      "payouts",
    ]);
    expect(items.every((i) => !(i.done && i.soon))).toBe(true);
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
