import { describe, expect, it } from "vitest";
import { groupLabel, JOB_TYPES } from "./jobs";

describe("job types", () => {
  it("name their groups classes, teams or groups", () => {
    expect(groupLabel("school")).toBe("class");
    expect(groupLabel("dance")).toBe("class");
    expect(groupLabel("sports")).toBe("team");
    expect(groupLabel("mini_session")).toBe("group");
    for (const type of JOB_TYPES) expect(["class", "team", "group"]).toContain(groupLabel(type));
  });
});
