import { describe, expect, it } from "vitest";
import { type ChecklistFacts, jobChecklist } from "./checklist";
import {
  type JobProgress,
  jobProgress,
  PROGRESS_STAGES,
  PROGRESS_STEPS,
  type ProgressInput,
  stageDoneOn,
  stepStage,
} from "./progress";
import { DEFAULT_RULES, type JobRules } from "./templates";

const TODAY = "2026-10-13";
const FALL: JobRules = {
  qrCardsDaysBefore: 5,
  shopOpens: "photosChecked",
  shopOpensDays: null,
  shopClosesDays: 10,
};

const facts = (over: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  status: "draft",
  pictureDay: "2026-10-20",
  children: 0,
  qrCards: null,
  hasReadyPhoto: false,
  failedPhotos: 0,
  taggingPending: false,
  leftovers: 0,
  flagged: 0,
  blankCardsPending: 0,
  taggingReviewed: false,
  today: TODAY,
  ...over,
});

const input = (
  checklist: Partial<ChecklistFacts> = {},
  over: Partial<ProgressInput> = {},
): ProgressInput => {
  const f = facts(checklist);
  return {
    status: f.status,
    pictureDay: f.pictureDay,
    createdAt: "2026-09-01T12:00:00.000Z",
    closesAt: null,
    rules: FALL,
    changed: [],
    checklist: jobChecklist("school", f),
    facts: {},
    ...over,
  };
};

const states = (p: JobProgress) =>
  Object.fromEntries(p.stages.flatMap((s) => s.steps).map((s) => [s.key, s.state]));
const step = (p: JobProgress, key: string) => {
  const found = p.stages.flatMap((s) => s.steps).find((s) => s.key === key);
  if (!found) throw new Error(key);
  return found;
};

/** Everything built is done up to selling. */
const sellingFacts = {
  status: "selling",
  pictureDay: "2026-09-24",
  children: 3,
  qrCards: { eligible: 3, withCard: 3 },
  hasReadyPhoto: true,
  taggingReviewed: true,
} as const;

describe("a job's Progress (D152)", () => {
  it("has six stages, every step in one of them, in order", () => {
    const p = jobProgress(input());
    expect(p.stages.map((s) => s.key)).toEqual([...PROGRESS_STAGES]);
    expect(p.stages.flatMap((s) => s.steps.map((x) => x.key))).toEqual([...PROGRESS_STEPS]);
    expect(stepStage("shopCloses")).toBe("selling");
    expect(stepStage("archive")).toBe("wrapUp");
  });

  it("a new draft: the job is made, adding subjects is now, the rest next, unbuilt steps Soon", () => {
    const p = jobProgress(input());
    expect(states(p)).toEqual({
      createJob: "done",
      addRoster: "now",
      printQrCards: "next",
      pictureDay: "next",
      uploadPhotos: "next",
      reviewTagging: "next",
      startSelling: "next",
      reminders: "soon",
      shopCloses: "automatic",
      sendToLab: "soon",
      delivery: "soon",
      yearbookExport: "soon",
      archive: "soon",
    });
    expect(p.current).toBe("prepare");
    // The job's creation falls back to its own time when the event log has nothing.
    expect(step(p, "createJob").at).toBe("2026-09-01T12:00:00.000Z");
  });

  it("plans days from the job's rules", () => {
    const p = jobProgress(input());
    expect(step(p, "printQrCards").planned).toBe("2026-10-15");
    expect(step(p, "pictureDay").planned).toBe("2026-10-20");
    expect(step(p, "startSelling")).toMatchObject({ planned: null, whenPhotosChecked: true });
    expect(step(p, "shopCloses")).toMatchObject({ afterOpeningDays: 10, closesAt: null });
    const later = jobProgress(
      input({}, { rules: { ...FALL, shopOpens: "afterPictureDay", shopOpensDays: 11 } }),
    );
    expect(step(later, "startSelling")).toMatchObject({
      planned: "2026-10-31",
      whenPhotosChecked: false,
    });
  });

  it("a draft holding a closing date shows the date, not the rule (ADR 0021)", () => {
    const withDate = jobProgress(input({}, { closesAt: "2026-11-30T05:00:00.000Z" }));
    expect(step(withDate, "shopCloses")).toMatchObject({
      state: "next",
      closesAt: "2026-11-30T05:00:00.000Z",
      afterOpeningDays: null,
    });
    const byHand = jobProgress(
      input({}, { rules: DEFAULT_RULES, closesAt: "2026-11-30T05:00:00.000Z" }),
    );
    expect(step(byHand, "shopCloses").closesAt).toBe("2026-11-30T05:00:00.000Z");
  });

  it("without a closing rule, Shop closes is a step for a person, not automatic", () => {
    const p = jobProgress(input({}, { rules: DEFAULT_RULES }));
    expect(step(p, "shopCloses")).toMatchObject({ state: "next", afterOpeningDays: null });
    expect(step(p, "printQrCards").planned).toBeNull();
  });

  it("done steps carry when and who, from the event log's facts", () => {
    const p = jobProgress(
      input(
        { children: 3, qrCards: { eligible: 3, withCard: 3 } },
        {
          facts: {
            addRoster: { at: "2026-09-02T10:00:00Z", actorId: "u1" },
            printQrCards: { at: "2026-09-20T10:00:00Z", actorId: null },
          },
        },
      ),
    );
    expect(step(p, "addRoster")).toMatchObject({
      state: "done",
      at: "2026-09-02T10:00:00Z",
      actorId: "u1",
    });
    expect(step(p, "printQrCards")).toMatchObject({ state: "done", actorId: null });
    expect(step(p, "pictureDay").state).toBe("now");
    expect(p.stages[0]?.done).toBe(true);
    expect(p.current).toBe("pictureDay");
    expect(stageDoneOn(p.stages[0] as JobProgress["stages"][number])).toBe("2026-09-20T10:00:00Z");
  });

  it("while selling, Shop closes is now with its closing date; earlier stages are finished", () => {
    const p = jobProgress(
      input(sellingFacts, {
        closesAt: "2026-10-15T14:00:00Z",
        changed: ["shopCloses"],
        facts: { startSelling: { at: "2026-10-05T14:00:00Z", actorId: "u1" } },
      }),
    );
    expect(step(p, "startSelling")).toMatchObject({ state: "done", at: "2026-10-05T14:00:00Z" });
    expect(step(p, "shopCloses")).toMatchObject({
      state: "now",
      closesAt: "2026-10-15T14:00:00Z",
      afterOpeningDays: null,
      changed: true,
    });
    expect(p.current).toBe("selling");
    expect(p.stages.filter((s) => s.done).map((s) => s.key)).toEqual([
      "prepare",
      "pictureDay",
      "photos",
    ]);
  });

  it("only steps still ahead say they were changed for this job", () => {
    const p = jobProgress(input(sellingFacts, { changed: ["qrCards", "shopOpens", "shopCloses"] }));
    expect(step(p, "printQrCards").changed).toBe(false);
    expect(step(p, "startSelling").changed).toBe(false);
    expect(step(p, "shopCloses").changed).toBe(true);
    expect(step(jobProgress(input({}, { changed: ["qrCards"] })), "printQrCards").changed).toBe(
      true,
    );
  });

  it("once closed, every built step is done and Fulfilment is current", () => {
    const p = jobProgress(
      input(
        { ...sellingFacts, status: "closed" },
        { facts: { closeShop: { at: "2026-10-16T05:00:00Z", actorId: null } } },
      ),
    );
    expect(step(p, "shopCloses")).toMatchObject({ state: "done", at: "2026-10-16T05:00:00Z" });
    expect(p.stages.flatMap((s) => s.steps).some((s) => s.state === "now")).toBe(false);
    expect(p.current).toBe("fulfilment");
    expect(p.stages.find((s) => s.key === "selling")?.done).toBe(true);
  });

  it("follows the checklist, so Progress and Home's Up next never disagree", () => {
    const f = facts({ children: 3, qrCards: { eligible: 3, withCard: 1 } });
    const c = jobChecklist("school", f);
    const p = jobProgress(input({ children: 3, qrCards: { eligible: 3, withCard: 1 } }));
    expect(c.next?.key).toBe("printQrCards");
    expect(step(p, "printQrCards").state).toBe("now");
  });
});
