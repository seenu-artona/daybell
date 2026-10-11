import { describe, expect, it } from "vitest";
import { checklistSteps } from "./checklist-steps";
import { SECTIONS, SOON_SECTIONS, sectionForPath } from "./nav";

describe("sectionForPath", () => {
  it("highlights the right menu item", () => {
    expect(sectionForPath("/app")).toBe("home");
    expect(sectionForPath("/app/")).toBe("home");
    expect(sectionForPath("/app/settings")).toBe("settings");
    expect(sectionForPath("/app/orders/123")).toBe("orders");
    expect(sectionForPath("/app/jobs/new")).toBe("jobs");
    expect(sectionForPath("/app/contacts/organizations")).toBe("contacts");
  });

  it("highlights nothing for pages outside the menu", () => {
    expect(sectionForPath("/app/shop")).toBeNull();
    expect(sectionForPath("/app/ordersx")).toBeNull();
  });

  it("lists every unbuilt section as soon", () => {
    expect(SOON_SECTIONS).toEqual(SECTIONS.filter((s) => !s.built).map((s) => s.key));
  });

  it("has jobs and contacts built (Phase 1 step 1)", () => {
    expect(SOON_SECTIONS).not.toContain("jobs");
    expect(SOON_SECTIONS).not.toContain("contacts");
  });
});

describe("checklistSteps", () => {
  it("marks the team step done once someone is invited", () => {
    expect(checklistSteps({ hasTeam: false, hasJob: false }).filter((s) => s.done)).toHaveLength(1);
    expect(
      checklistSteps({ hasTeam: true, hasJob: false }).find((s) => s.key === "team")?.done,
    ).toBe(true);
  });

  it("links the job step to the wizard until a job exists", () => {
    const job = checklistSteps({ hasTeam: false, hasJob: false }).find((s) => s.key === "job");
    expect(job).toMatchObject({ href: "/app/jobs/new", done: false, soon: false });
    expect(
      checklistSteps({ hasTeam: false, hasJob: true }).find((s) => s.key === "job")?.done,
    ).toBe(true);
  });

  it("never marks unbuilt steps done", () => {
    expect(
      checklistSteps({ hasTeam: true, hasJob: false })
        .filter((s) => s.soon)
        .every((s) => !s.done),
    ).toBe(true);
  });
});
