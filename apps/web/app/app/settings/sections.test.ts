import { describe, expect, it } from "vitest";
import { settingsSectionFor, settingsSections } from "./sections";

describe("Settings sections (D154)", () => {
  it("Team and Templates for everyone; Stripe and Taxes for owners and admins", () => {
    expect(settingsSections("owner")).toEqual(["team", "payouts", "taxes", "templates"]);
    expect(settingsSections("admin")).toEqual(["team", "payouts", "taxes", "templates"]);
    expect(settingsSections("photographer")).toEqual(["team", "templates"]);
    expect(settingsSections("staff")).toEqual(["team", "templates"]);
  });

  it("finds the section from the address; a template's own page has its own frame", () => {
    expect(settingsSectionFor("/app/settings")).toBe("team");
    expect(settingsSectionFor("/app/settings/")).toBe("team");
    expect(settingsSectionFor("/app/settings/payouts")).toBe("payouts");
    expect(settingsSectionFor("/app/settings/taxes")).toBe("taxes");
    expect(settingsSectionFor("/app/settings/templates")).toBe("templates");
    expect(settingsSectionFor("/app/settings/templates/0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e")).toBe(
      null,
    );
  });
});
