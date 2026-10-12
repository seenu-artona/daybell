import { describe, expect, it } from "vitest";
import {
  daysUntil,
  type JobFacts,
  localDay,
  MILESTONES,
  milestone,
  milestoneTodos,
  sellChecklist,
  timeline,
  todoProgress,
} from "./job-page";
import { JOB_STATUSES } from "./jobs";

const draft = (over: Partial<JobFacts> = {}): JobFacts => ({
  status: "draft",
  pictureDay: "2026-10-14",
  children: 0,
  today: "2026-10-11",
  ...over,
});

/** Every combination of status, roster size and date the tests sweep. */
const everyFacts = (): JobFacts[] =>
  JOB_STATUSES.flatMap((status) =>
    [0, 1, 500].flatMap((children) =>
      ["2020-01-01", "2026-10-13", "2026-10-14", "2030-12-31"].map((today) =>
        draft({ status, children, today }),
      ),
    ),
  );

describe("milestone", () => {
  it("is set up while a draft has no roster, whatever the date", () => {
    expect(milestone(draft())).toBe("setUp");
    expect(milestone(draft({ today: "2026-10-14" }))).toBe("setUp");
    expect(milestone(draft({ today: "2027-01-01" }))).toBe("setUp");
  });

  it("is set up with a roster before picture day, and picture day from that day on", () => {
    expect(milestone(draft({ children: 3, today: "2026-10-13" }))).toBe("setUp");
    expect(milestone(draft({ children: 3, today: "2026-10-14" }))).toBe("pictureDay");
    expect(milestone(draft({ children: 3, today: "2026-12-01" }))).toBe("pictureDay");
  });

  it("is selling while the job sells, and none once it is closed", () => {
    expect(milestone(draft({ status: "selling" }))).toBe("selling");
    expect(milestone(draft({ status: "selling", children: 9 }))).toBe("selling");
    expect(milestone(draft({ status: "closed", children: 9 }))).toBeNull();
  });

  it("never returns milestones whose data doesn't exist yet (photos in, fulfilment)", () => {
    const seen = new Set(everyFacts().map(milestone));
    expect(seen).not.toContain("photosIn");
    expect(seen).not.toContain("fulfilment");
    for (const m of seen) if (m !== null) expect(MILESTONES).toContain(m);
  });
});

describe("timeline", () => {
  it("always has the five milestones, in order", () => {
    for (const facts of everyFacts())
      expect(timeline(facts).map((m) => m.key)).toEqual([
        "setUp",
        "pictureDay",
        "photosIn",
        "selling",
        "fulfilment",
      ]);
  });

  it("has exactly one current milestone, done ones before it and upcoming ones after", () => {
    const rank = { done: 0, current: 1, upcoming: 2 };
    for (const facts of everyFacts()) {
      if (facts.status === "closed") continue;
      const states = timeline(facts).map((m) => m.state);
      expect(states.filter((s) => s === "current")).toHaveLength(1);
      const ranks = states.map((s) => rank[s]);
      expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
    }
  });

  it("marks every milestone done, none current, once the job is closed", () => {
    const view = timeline(draft({ status: "closed", children: 9 }));
    expect(view.every((m) => m.state === "done" && !m.soon)).toBe(true);
  });

  it("starts at Set up for a new draft, with the unbuilt milestones Soon", () => {
    expect(timeline(draft())).toEqual([
      { key: "setUp", state: "current", soon: false },
      { key: "pictureDay", state: "upcoming", soon: false },
      { key: "photosIn", state: "upcoming", soon: true },
      { key: "selling", state: "upcoming", soon: true },
      { key: "fulfilment", state: "upcoming", soon: true },
    ]);
  });

  it("moves to Picture day on the day with a roster", () => {
    const view = timeline(draft({ children: 2, today: "2026-10-14" }));
    expect(view.map((m) => m.state)).toEqual([
      "done",
      "current",
      "upcoming",
      "upcoming",
      "upcoming",
    ]);
  });

  it("puts a selling job at Selling: not Soon while current, Fulfilment still Soon", () => {
    const view = timeline(draft({ status: "selling", children: 2 }));
    expect(view.find((m) => m.key === "selling")).toEqual({
      key: "selling",
      state: "current",
      soon: false,
    });
    expect(view.find((m) => m.key === "photosIn")?.state).toBe("done");
    expect(view.find((m) => m.key === "fulfilment")).toEqual({
      key: "fulfilment",
      state: "upcoming",
      soon: true,
    });
  });
});

describe("milestoneTodos", () => {
  it("sets up with Job created (always done), Roster added and Print QR cards (Soon)", () => {
    expect(milestoneTodos("setUp", { status: "draft", children: 0 })).toEqual([
      { key: "jobCreated", done: true, soon: false },
      { key: "rosterAdded", done: false, soon: false },
      { key: "printQrCards", done: false, soon: true },
    ]);
    expect(
      milestoneTodos("setUp", { status: "draft", children: 4 }).find(
        (t) => t.key === "rosterAdded",
      ),
    ).toEqual({ key: "rosterAdded", done: true, soon: false });
  });

  it("lists the next real tasks of later milestones as Soon", () => {
    const keys = (m: Parameters<typeof milestoneTodos>[0]) =>
      milestoneTodos(m, { status: "draft", children: 3 }).map((t) => t.key);
    expect(keys("pictureDay")).toEqual(["printQrCards", "uploadPhotos"]);
    expect(keys("photosIn")).toEqual(["tagPhotos"]);
    expect(keys("selling")).toEqual(["choosePriceList", "connectPayouts", "startSelling"]);
    expect(keys("fulfilment")).toEqual(["sendToLab"]);
    for (const m of ["pictureDay", "photosIn", "selling", "fulfilment"] as const)
      expect(
        milestoneTodos(m, { status: "draft", children: 3 }).every((t) => t.soon && !t.done),
      ).toBe(true);
  });

  it("never marks Print QR cards done: QR cards ship in step 3", () => {
    for (const status of JOB_STATUSES)
      for (const m of ["setUp", "pictureDay"] as const)
        expect(
          milestoneTodos(m, { status, children: 10 }).find((t) => t.key === "printQrCards"),
        ).toEqual({ key: "printQrCards", done: false, soon: true });
  });

  it("marks the price list, payouts and Start selling done once the job sells, and Soon before", () => {
    const selling = (status: JobFacts["status"]) =>
      milestoneTodos("selling", { status, children: 3 });
    expect(selling("draft")).toEqual([
      { key: "choosePriceList", done: false, soon: true },
      { key: "connectPayouts", done: false, soon: true },
      { key: "startSelling", done: false, soon: true },
    ]);
    for (const status of ["selling", "closed"] as const) {
      expect(selling(status).every((t) => t.done && !t.soon)).toBe(true);
      expect(todoProgress(selling(status))).toEqual({ done: 3, total: 3 });
    }
  });

  it("is never both done and Soon", () => {
    for (const status of JOB_STATUSES)
      for (const m of MILESTONES)
        for (const children of [0, 2])
          expect(milestoneTodos(m, { status, children }).some((t) => t.done && t.soon)).toBe(false);
  });
});

describe("todoProgress", () => {
  it("counts done to-dos out of all of them", () => {
    expect(todoProgress(milestoneTodos("setUp", { status: "draft", children: 0 }))).toEqual({
      done: 1,
      total: 3,
    });
    expect(todoProgress(milestoneTodos("setUp", { status: "draft", children: 6 }))).toEqual({
      done: 2,
      total: 3,
    });
    expect(todoProgress([])).toEqual({ done: 0, total: 0 });
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
