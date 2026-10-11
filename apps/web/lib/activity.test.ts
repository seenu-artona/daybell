import { describe, expect, it } from "vitest";
import { activityType } from "./activity";

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
