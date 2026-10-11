import { describe, expect, it } from "vitest";
import { checklistSteps } from "./checklist-steps";
import { SECTIONS, SOON_SECTIONS, sectionForPath } from "./nav";

describe("sectionForPath", () => {
  it("highlights the right menu item", () => {
    expect(sectionForPath("/app")).toBe("home");
    expect(sectionForPath("/app/")).toBe("home");
    expect(sectionForPath("/app/settings")).toBe("settings");
    expect(sectionForPath("/app/orders/123")).toBe("orders");
  });

  it("highlights nothing for pages outside the menu", () => {
    expect(sectionForPath("/app/shop")).toBeNull();
    expect(sectionForPath("/app/ordersx")).toBeNull();
  });

  it("lists every unbuilt section as soon", () => {
    expect(SOON_SECTIONS).toEqual(SECTIONS.filter((s) => !s.built).map((s) => s.key));
  });
});

describe("checklistSteps", () => {
  it("marks the team step done once someone is invited", () => {
    expect(checklistSteps({ hasTeam: false }).filter((s) => s.done)).toHaveLength(1);
    expect(checklistSteps({ hasTeam: true }).find((s) => s.key === "team")?.done).toBe(true);
  });

  it("never marks unbuilt steps done", () => {
    expect(
      checklistSteps({ hasTeam: true })
        .filter((s) => s.soon)
        .every((s) => !s.done),
    ).toBe(true);
  });
});
