import { describe, expect, it } from "vitest";
import { JOB_VIEWS, jobsQuery, jobViewFrom, jobViewHref } from "./job-views";

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
});
