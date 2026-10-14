import { describe, expect, it } from "vitest";
import { JOB_VIEWS, jobsQuery, jobViewFrom, jobViewHref, progressEnd } from "./job-views";

describe("Jobs views (D144)", () => {
  it("are All, Draft, Selling and Closed", () => {
    expect(JOB_VIEWS).toEqual(["", "draft", "selling", "closed"]);
  });

  it("read ?status=, and treat anything unknown as All", () => {
    expect(jobViewFrom("selling")).toBe("selling");
    for (const v of [null, "", "live", "Lincoln"]) expect(jobViewFrom(v)).toBe("");
  });

  it("link to ?status= and ask the API for that status (GET /jobs?status=)", () => {
    expect(jobViewHref("")).toBe("/app/jobs");
    expect(jobViewHref("closed")).toBe("/app/jobs?status=closed");
    expect(jobsQuery("", "2026-10-14", null)).toBe("/jobs?today=2026-10-14");
    expect(jobsQuery("draft", "2026-10-14", "abc")).toBe(
      "/jobs?today=2026-10-14&status=draft&cursor=abc",
    );
  });

  it("end a row's progress line with the next task, All done when nothing is left, or nothing while waiting", () => {
    expect(progressEnd({ milestone: "setUp", next: "addRoster" })).toEqual({
      kind: "next",
      task: "addRoster",
    });
    expect(progressEnd({ milestone: null, next: null })).toEqual({ kind: "allDone" });
    expect(progressEnd({ milestone: "selling", next: null })).toBeNull();
  });
});
