import { ACTIVITY_TYPES } from "@daybell/api";
import { describe, expect, it } from "vitest";
import { activityType, STORED_ACTIVITY_TYPES, unnamedSubject } from "./activity";

describe("activityType", () => {
  it("shows events written before organizations became clients as client events", () => {
    expect(activityType("organization.created")).toBe("client.created");
    expect(activityType("organization.updated")).toBe("client.updated");
    expect(activityType("client.created")).toBe("client.created");
  });

  it("hides events the activity log doesn't show", () => {
    expect(activityType("job_category.created")).toBeNull();
    expect(activityType("made.up")).toBeNull();
  });

  it("shows one line per roster import, not each child or class (Seenu, Oct 11 2026)", () => {
    expect(activityType("roster.imported")).toBe("roster.imported");
    for (const hidden of [
      "child.created",
      "child.updated",
      "child.deleted",
      "job_group.created",
      "job_group.updated",
    ])
      expect(activityType(hidden)).toBeNull();
  });
});

describe("STORED_ACTIVITY_TYPES", () => {
  it("lists exactly the stored types the log shows, legacy names included, so the query filters before its limit", () => {
    for (const type of ACTIVITY_TYPES) expect(STORED_ACTIVITY_TYPES).toContain(type);
    expect(STORED_ACTIVITY_TYPES).toContain("organization.created");
    expect(STORED_ACTIVITY_TYPES).toContain("organization.updated");
    for (const type of STORED_ACTIVITY_TYPES) expect(activityType(type)).not.toBeNull();
    for (const hidden of ["child.created", "child.updated", "job_group.created"])
      expect(STORED_ACTIVITY_TYPES).not.toContain(hidden);
  });
});

describe("unnamedSubject", () => {
  it("calls a job or roster import's missing subject a job, and a client event's a client", () => {
    expect(unnamedSubject("job.created")).toBe("aJob");
    expect(unnamedSubject("roster.imported")).toBe("aJob");
    expect(unnamedSubject("client.updated")).toBe("aClient");
  });
});
