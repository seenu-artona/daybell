import type { ProgressStepView } from "@daybell/api";
import { describe, expect, it } from "vitest";
import { stepView } from "./progress-view";

const JOB = { id: "j1", status: "draft", pictureDay: "2026-10-20" };
const step = (over: Partial<ProgressStepView>): ProgressStepView => ({
  key: "printQrCards",
  state: "next",
  at: null,
  by: null,
  planned: null,
  closesAt: null,
  afterOpeningDays: null,
  whenPhotosChecked: false,
  changed: false,
  ...over,
});
const TODAY = "2026-10-13";

describe("a Progress step (D152)", () => {
  it("the step to do now has one action, a link only for roles that can do it", () => {
    const now = step({ key: "printQrCards", state: "now", planned: "2026-10-15" });
    expect(stepView(now, JOB, "photographer", TODAY)).toEqual({
      detail: { type: "planned", day: "2026-10-15" },
      action: { kind: "link", href: "/app/jobs/j1/people?print=qr", label: "printQrCards" },
      change: null,
      undo: null,
    });
    expect(stepView(now, JOB, "staff", TODAY).action).toBeNull();
  });

  it("Publish shop is the owners' and admins' action; others just see it's next", () => {
    const now = step({ key: "startSelling", state: "now", whenPhotosChecked: true });
    expect(stepView(now, JOB, "admin", TODAY)).toMatchObject({
      detail: { type: "whenPhotosChecked" },
      action: { kind: "publish", href: "/app/jobs/j1?sell=1" },
    });
    expect(stepView(now, JOB, "photographer", TODAY).action).toBeNull();
  });

  it("done steps say when and who; printed cards keep a quiet Print again", () => {
    const done = step({ state: "done", at: "2026-09-20T10:00:00Z", by: "a@np.example" });
    expect(stepView(done, JOB, "owner", TODAY)).toMatchObject({
      detail: { type: "done", at: "2026-09-20T10:00:00Z", day: null, by: "a@np.example" },
      action: { kind: "printAgain", href: "/app/jobs/j1/people?print=qr" },
    });
    const day = step({ key: "pictureDay", state: "done", planned: "2026-10-01" });
    expect(stepView(day, JOB, "owner", TODAY).detail).toMatchObject({ day: "2026-10-01" });
  });

  it("picture day counts the days when it is now", () => {
    const now = step({ key: "pictureDay", state: "now", planned: "2026-10-20" });
    expect(stepView(now, JOB, "owner", TODAY).detail).toEqual({
      type: "pictureDay",
      day: "2026-10-20",
      days: 7,
    });
  });

  it("while selling, Shop closes shows its date and its Change date; the rule isn't changed there", () => {
    const selling = { ...JOB, status: "selling" };
    const closes = step({
      key: "shopCloses",
      state: "now",
      closesAt: "2026-10-16T04:00:00.000Z",
      changed: true,
    });
    const view = stepView(closes, selling, "owner", TODAY);
    expect(view.detail).toMatchObject({ type: "closes" });
    expect(view.action).toEqual({ kind: "changeClosingDate" });
    expect(view.change).toBeNull();
    expect(view.undo).toBe("shopCloses");
    expect(stepView(closes, selling, "staff", TODAY)).toMatchObject({ action: null, undo: null });
  });

  it("steps ahead with a rule can be changed by owners and admins; automatic ones say when", () => {
    const automatic = step({ key: "shopCloses", state: "automatic", afterOpeningDays: 10 });
    expect(stepView(automatic, JOB, "owner", TODAY)).toEqual({
      detail: { type: "afterOpening", days: 10 },
      action: { kind: "changeClosingDate" },
      change: "shopCloses",
      undo: null,
    });
    expect(stepView(automatic, JOB, "photographer", TODAY).change).toBeNull();
    expect(stepView(step({ key: "uploadPhotos" }), JOB, "owner", TODAY).change).toBeNull();
  });

  it("a selling job whose photos need checking again still offers Change date on Shop closes", () => {
    const selling = { ...JOB, status: "selling" };
    // reviewTagging is the step to do now, so Shop closes is next.
    const closes = step({ key: "shopCloses", state: "next", closesAt: "2026-10-16T04:00:00.000Z" });
    expect(stepView(closes, selling, "admin", TODAY)).toMatchObject({
      detail: { type: "closes" },
      action: { kind: "changeClosingDate" },
      change: null,
    });
    // The same when QR cards need printing again (a subject added while selling).
    const noDate = step({ key: "shopCloses", state: "next" });
    expect(stepView(noDate, selling, "owner", TODAY)).toMatchObject({
      detail: { type: "noClosingDate" },
      action: { kind: "changeClosingDate" },
    });
    expect(stepView(noDate, selling, "photographer", TODAY).action).toBeNull();
  });

  it("a draft holding a closing date shows it, with Change date and the rule's Change", () => {
    const held = step({
      key: "shopCloses",
      state: "next",
      closesAt: "2026-11-30T05:00:00.000Z",
    });
    expect(stepView(held, JOB, "owner", TODAY)).toMatchObject({
      detail: { type: "closes", at: "2026-11-30T05:00:00.000Z" },
      action: { kind: "changeClosingDate" },
      change: "shopCloses",
    });
    const byHand = step({ key: "shopCloses", state: "next" });
    expect(stepView(byHand, JOB, "owner", TODAY).detail).toEqual({ type: "byHand" });
  });

  it("a closed shop's Shop closes is history: no date to change", () => {
    const closed = { ...JOB, status: "closed" };
    const done = step({ key: "shopCloses", state: "done", at: "2026-10-16T05:00:00Z" });
    expect(stepView(done, closed, "owner", TODAY).action).toBeNull();
  });
});
