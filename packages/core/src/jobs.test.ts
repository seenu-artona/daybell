import { describe, expect, it } from "vitest";
import { JOB_TYPES, jobTypeRule, ORGANIZATION_KINDS, organizationRequired } from "./jobs";

describe("job types", () => {
  it("need an organization for school, preschool, sports and dance only", () => {
    expect(JOB_TYPES.filter(organizationRequired)).toEqual([
      "school",
      "preschool",
      "sports",
      "dance",
    ]);
  });

  it("name their groups classes, teams or groups", () => {
    expect(jobTypeRule("school").group).toBe("class");
    expect(jobTypeRule("sports").group).toBe("team");
    expect(jobTypeRule("mini_session").group).toBe("group");
  });

  it("suggest a matching organization kind", () => {
    expect(jobTypeRule("preschool").organizationKind).toBe("daycare");
    expect(jobTypeRule("dance").organizationKind).toBe("dance_studio");
    for (const type of JOB_TYPES) {
      expect(ORGANIZATION_KINDS).toContain(jobTypeRule(type).organizationKind);
    }
  });
});
