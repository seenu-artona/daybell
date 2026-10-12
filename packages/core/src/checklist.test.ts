import { describe, expect, it } from "vitest";
import {
  type ChecklistFacts,
  canDoOnboardingTask,
  canDoTask,
  DATE_CLOSE_DAYS,
  isOnTrack,
  JOB_CHECKLISTS,
  jobChecklist,
  ONBOARDING_TASKS,
  onboardingChecklist,
  onboardingComplete,
  rankUpNext,
  seesOnboarding,
  TASK_KEYS,
  taskTarget,
  type UpNextCandidate,
  upNextForJob,
} from "./checklist";
import { MILESTONES } from "./job-page";
import { JOB_STATUSES, JOB_TYPES } from "./jobs";

const TODAY = "2026-10-12";

const facts = (over: Partial<ChecklistFacts> = {}): ChecklistFacts => ({
  status: "draft",
  pictureDay: "2027-01-15",
  children: 0,
  qrCards: null,
  hasReadyPhoto: false,
  failedPhotos: 0,
  today: TODAY,
  ...over,
});

/** A job with a roster and every card printed. */
const setUpDone = (over: Partial<ChecklistFacts> = {}) =>
  facts({ children: 3, qrCards: { eligible: 3, withCard: 3 }, ...over });

const list = (over: Partial<ChecklistFacts> = {}) => jobChecklist("school", facts(over));
const states = (over: Partial<ChecklistFacts> = {}) =>
  Object.fromEntries(
    list(over)
      .groups.flatMap((g) => g.tasks)
      .map((t) => [t.key, t.state]),
  );

/** Every combination of status, roster, cards, photos and date the sweeps use. */
const everyFacts = (): ChecklistFacts[] =>
  JOB_STATUSES.flatMap((status) =>
    [0, 2].flatMap((children) =>
      [null, { eligible: 2, withCard: 1 }, { eligible: 2, withCard: 2 }].flatMap((qrCards) =>
        [false, true].flatMap((hasReadyPhoto) =>
          [0, 3].flatMap((failedPhotos) =>
            ["2026-10-01", "2026-10-12", "2026-10-20", "2027-06-01"].map((pictureDay) =>
              facts({ status, children, qrCards, hasReadyPhoto, failedPhotos, pictureDay }),
            ),
          ),
        ),
      ),
    ),
  );

describe("jobChecklist", () => {
  it("has one list per job type, every type the same today", () => {
    expect(Object.keys(JOB_CHECKLISTS).sort()).toEqual([...JOB_TYPES].sort());
    for (const type of JOB_TYPES) expect(JOB_CHECKLISTS[type]).toEqual([...TASK_KEYS]);
  });

  it("groups the built tasks by milestone, in milestone order, and hides empty groups (Seenu, answer 1)", () => {
    const c = list();
    expect(c.groups.map((g) => [g.milestone, g.tasks.map((t) => t.key)])).toEqual([
      ["setUp", ["createJob", "addRoster", "printQrCards"]],
      ["pictureDay", ["pictureDay"]],
      ["photosIn", ["uploadPhotos"]],
    ]);
    expect(c.total).toBe(5);
    for (const type of JOB_TYPES) {
      const order = jobChecklist(type, facts()).groups.map((g) => MILESTONES.indexOf(g.milestone));
      expect(order).toEqual([...order].sort((a, b) => a - b));
    }
  });

  it("starts a new job with Create the job done and Add the roster next", () => {
    expect(states()).toEqual({
      createJob: "done",
      addRoster: "next",
      printQrCards: "todo",
      pictureDay: "todo",
      uploadPhotos: "todo",
    });
    const c = list();
    expect([c.done, c.total, c.next?.key, c.milestone]).toEqual([1, 5, "addRoster", "setUp"]);
  });

  it("ticks Add the roster and Print QR cards from the roster and the cards", () => {
    expect(states({ children: 2 }).addRoster).toBe("done");
    expect(states({ children: 2, qrCards: { eligible: 2, withCard: 1 } }).printQrCards).toBe(
      "next",
    );
    expect(states({ children: 2, qrCards: { eligible: 2, withCard: 2 } }).printQrCards).toBe(
      "done",
    );
    // Every child marked Do not photograph: nothing to print. An empty roster is never done.
    expect(states({ children: 2, qrCards: { eligible: 0, withCard: 0 } }).printQrCards).toBe(
      "done",
    );
    expect(states({ children: 0, qrCards: { eligible: 0, withCard: 0 } }).printQrCards).toBe(
      "todo",
    );
  });

  it("ticks Picture day only once the date has passed in the person's own day", () => {
    expect(states(setUpDone({ pictureDay: "2026-10-13" })).pictureDay).toBe("next");
    expect(states(setUpDone({ pictureDay: TODAY })).pictureDay).toBe("next");
    expect(states(setUpDone({ pictureDay: "2026-10-11" })).pictureDay).toBe("done");
  });

  it("ticks Upload photos once the job has a ready photo", () => {
    expect(states(setUpDone({ pictureDay: "2026-10-01" })).uploadPhotos).toBe("next");
    expect(states(setUpDone({ pictureDay: "2026-10-01", hasReadyPhoto: true })).uploadPhotos).toBe(
      "done",
    );
  });

  it("keeps the milestone at the next task's group: dates don't move it (Seenu, answer 2)", () => {
    // Picture day passed without a roster: still Set up.
    expect(list({ pictureDay: "2026-01-01" }).milestone).toBe("setUp");
    expect(jobChecklist("school", setUpDone()).milestone).toBe("pictureDay");
    expect(jobChecklist("school", setUpDone({ pictureDay: "2026-10-01" })).milestone).toBe(
      "photosIn",
    );
    // Photos uploaded before picture day: Picture day is still next.
    const early = jobChecklist("school", setUpDone({ hasReadyPhoto: true }));
    expect([early.next?.key, early.milestone]).toEqual(["pictureDay", "pictureDay"]);
  });

  it("shows the next stage once every built task of a draft is done", () => {
    const c = jobChecklist("school", setUpDone({ pictureDay: "2026-10-01", hasReadyPhoto: true }));
    expect([c.done, c.total, c.next, c.milestone]).toEqual([5, 5, null, "selling"]);
  });

  it("follows the status once the job sells or closes", () => {
    expect(list({ status: "selling" }).milestone).toBe("selling");
    const closed = list({ status: "closed" });
    expect([closed.milestone, closed.next]).toEqual([null, null]);
    // A closed job's tasks keep their real state; none is next.
    expect(closed.groups.flatMap((g) => g.tasks).some((t) => t.state === "next")).toBe(false);
  });

  it("is consistent for every combination: one next at most, counts add up, never ticked by hand", () => {
    for (const f of everyFacts()) {
      const c = jobChecklist("school", f);
      const tasks = c.groups.flatMap((g) => g.tasks);
      expect(c.total).toBe(tasks.length);
      expect(c.done).toBe(tasks.filter((t) => t.done).length);
      expect(tasks.filter((t) => t.state === "next").length).toBeLessThanOrEqual(1);
      expect(tasks.every((t) => (t.state === "done") === t.done)).toBe(true);
      if (c.next) expect(tasks.find((t) => !t.done)?.key).toBe(c.next.key);
      // The same facts always give the same list.
      expect(jobChecklist("school", f)).toEqual(c);
    }
  });
});

describe("canDoTask and taskTarget", () => {
  it("lets only roster editors act on roster, card and photo tasks (Seenu, answer 10)", () => {
    for (const role of ["owner", "admin", "photographer"])
      expect(canDoTask(role, "addRoster") && canDoTask(role, "uploadPhotos")).toBe(true);
    expect(canDoTask("staff", "addRoster")).toBe(false);
    expect(canDoTask("staff", "printQrCards")).toBe(false);
    expect(canDoTask("staff", "reviewFailedPhotos")).toBe(false);
    expect(canDoTask("staff", "pictureDay")).toBe(true);
  });

  it("points each task at the page where the work happens", () => {
    expect(TASK_KEYS.map(taskTarget)).toEqual([
      "overview",
      "people",
      "peoplePrint",
      "overview",
      "photos",
    ]);
    expect(taskTarget("reviewFailedPhotos")).toBe("photos");
  });
});

describe("upNextForJob", () => {
  const pick = (f: ChecklistFacts) => upNextForJob(jobChecklist("school", f), f);

  it("ranks a past picture day without photos first", () => {
    expect(pick(facts({ pictureDay: "2026-10-09" }))).toEqual({
      task: "uploadPhotos",
      reason: { kind: "photosOverdue", days: 3 },
    });
  });

  it("flags Set up tasks within 14 days before picture day, the day itself included", () => {
    expect(pick(facts({ pictureDay: "2026-10-15" }))).toEqual({
      task: "addRoster",
      reason: { kind: "dateClose", days: 3 },
    });
    expect(pick(facts({ children: 2, pictureDay: TODAY }))).toEqual({
      task: "printQrCards",
      reason: { kind: "dateClose", days: 0 },
    });
    expect(pick(facts({ pictureDay: "2026-10-26" }))?.reason).toEqual({
      kind: "dateClose",
      days: DATE_CLOSE_DAYS,
    });
    expect(pick(facts({ pictureDay: "2026-10-27" }))?.reason).toEqual({ kind: "nextStep" });
    // Set up done: no close date, and Picture day (no page of its own) is skipped for the next task with one.
    expect(pick(setUpDone({ pictureDay: "2026-10-13" }))).toEqual({
      task: "uploadPhotos",
      reason: { kind: "nextStep" },
    });
  });

  it("never picks a task whose page is the Overview itself (Create the job, Picture day)", () => {
    for (const f of everyFacts()) {
      const p = pick(f);
      if (p) expect(["createJob", "pictureDay"]).not.toContain(p.task);
    }
    // Photos already uploaded before picture day: only Picture day is left, so nothing to do.
    expect(pick(setUpDone({ hasReadyPhoto: true }))).toBeNull();
  });

  it("flags failed photos as broken, after dates", () => {
    expect(pick(setUpDone({ failedPhotos: 4 }))).toEqual({
      task: "reviewFailedPhotos",
      reason: { kind: "brokenPhotos", count: 4 },
    });
    expect(pick(facts({ pictureDay: "2026-10-14", failedPhotos: 4 }))?.reason.kind).toBe(
      "dateClose",
    );
  });

  it("falls back to the next step, and picks nothing when nothing is left or the job is closed", () => {
    expect(pick(facts())).toEqual({ task: "addRoster", reason: { kind: "nextStep" } });
    expect(pick(setUpDone({ pictureDay: "2026-10-01", hasReadyPhoto: true }))).toBeNull();
    expect(pick(facts({ status: "closed", pictureDay: "2026-10-01" }))).toBeNull();
  });

  it("never invents a reason without its data", () => {
    for (const f of everyFacts()) {
      const p = pick(f);
      if (!p) continue;
      if (p.reason.kind === "brokenPhotos") expect(f.failedPhotos).toBeGreaterThan(0);
      if (p.reason.kind === "photosOverdue") expect(f.hasReadyPhoto).toBe(false);
      expect(f.status).not.toBe("closed");
    }
  });
});

describe("isOnTrack", () => {
  const onTrack = (f: ChecklistFacts) => isOnTrack(jobChecklist("school", f), f);

  it("is never on track during Set up", () => {
    expect(onTrack(facts())).toBe(false);
    expect(onTrack(facts({ pictureDay: "2027-12-01" }))).toBe(false);
  });

  it("is on track past Set up with no date pressure and nothing broken", () => {
    expect(onTrack(setUpDone())).toBe(true);
    expect(onTrack(setUpDone({ failedPhotos: 1 }))).toBe(false);
    expect(onTrack(setUpDone({ pictureDay: "2026-10-01" }))).toBe(false);
    expect(onTrack(setUpDone({ pictureDay: "2026-10-01", hasReadyPhoto: true }))).toBe(true);
  });

  it("is on track once closed", () => {
    expect(onTrack(facts({ status: "closed" }))).toBe(true);
  });
});

describe("rankUpNext", () => {
  const c = (
    jobId: string,
    pictureDay: string,
    reason: UpNextCandidate["reason"],
  ): UpNextCandidate => ({ jobId, pictureDay, task: "addRoster", reason });

  it("orders a date first, then broken, then next steps (D143)", () => {
    const ranked = rankUpNext(
      [
        c("a", "2027-01-01", { kind: "nextStep" }),
        c("b", "2026-11-01", { kind: "brokenPhotos", count: 2 }),
        c("c", "2026-10-20", { kind: "dateClose", days: 8 }),
        c("d", "2026-09-01", { kind: "photosOverdue", days: 41 }),
      ],
      TODAY,
    );
    expect(ranked.map((x) => x.jobId)).toEqual(["d", "c", "b", "a"]);
  });

  it("breaks ties by the nearest date, past or future, then by job id", () => {
    const ranked = rankUpNext(
      [
        c("z", "2026-12-01", { kind: "nextStep" }),
        c("y", "2026-10-02", { kind: "nextStep" }),
        c("x", "2026-10-22", { kind: "nextStep" }),
        c("b", "2026-10-15", { kind: "nextStep" }),
        c("a", "2026-10-09", { kind: "nextStep" }),
      ],
      TODAY,
    );
    expect(ranked.map((x) => x.jobId)).toEqual(["a", "b", "x", "y", "z"]);
  });

  it("doesn't change its input", () => {
    const input = [
      c("b", "2026-10-20", { kind: "nextStep" }),
      c("a", "2026-10-20", { kind: "nextStep" }),
    ];
    rankUpNext(input, TODAY);
    expect(input.map((x) => x.jobId)).toEqual(["b", "a"]);
  });
});

describe("onboarding", () => {
  it("lists the built tasks only: account and first job (Seenu, answers 4 and 12: no team task)", () => {
    expect(onboardingChecklist({ hasJob: false })).toEqual([
      { key: "account", done: true, state: "done" },
      { key: "firstJob", done: false, state: "next" },
    ]);
    expect(ONBOARDING_TASKS).toEqual(["account", "firstJob"]);
  });

  it("is complete only when every built task is done", () => {
    expect(onboardingComplete(onboardingChecklist({ hasJob: false }))).toBe(false);
    expect(onboardingComplete(onboardingChecklist({ hasJob: true }))).toBe(true);
  });

  it("is seen by owners and admins, who create jobs", () => {
    expect(["owner", "admin", "photographer", "staff"].map(seesOnboarding)).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect(canDoOnboardingTask("owner", "firstJob")).toBe(true);
    expect(canDoOnboardingTask("admin", "firstJob")).toBe(true);
    expect(canDoOnboardingTask("photographer", "firstJob")).toBe(false);
    expect(canDoOnboardingTask("owner", "account")).toBe(false);
  });
});
