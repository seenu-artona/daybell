import { describe, expect, it } from "vitest";
import { initialsFromEmail } from "./initials";

describe("initialsFromEmail", () => {
  it("takes the first letter of up to two parts before the @", () => {
    expect(initialsFromEmail("maya.johnson@example.test")).toBe("MJ");
    expect(initialsFromEmail("pat@example.test")).toBe("P");
    expect(initialsFromEmail("roster-owner-desktop-1@example.test")).toBe("RO");
    expect(initialsFromEmail("zoë_côté@example.test")).toBe("ZC");
    expect(initialsFromEmail("_x@example.test")).toBe("X");
  });

  it("falls back to D when there is nothing to use", () => {
    expect(initialsFromEmail("")).toBe("D");
    expect(initialsFromEmail("@example.test")).toBe("D");
    expect(initialsFromEmail("..@example.test")).toBe("D");
  });
});
