import { describe, expect, it } from "vitest";
import { initialsFromEmail, NO_INITIALS } from "./initials";

describe("initialsFromEmail", () => {
  it("takes the first letter of up to two parts before the @", () => {
    expect(initialsFromEmail("maya.johnson@example.test")).toBe("MJ");
    expect(initialsFromEmail("pat@example.test")).toBe("P");
    expect(initialsFromEmail("roster-owner-desktop-1@example.test")).toBe("RO");
    expect(initialsFromEmail("zoë_côté@example.test")).toBe("ZC");
    expect(initialsFromEmail("_x@example.test")).toBe("X");
  });

  it("falls back to a neutral non-letter when there is nothing to use", () => {
    expect(NO_INITIALS).not.toMatch(/\p{L}|\p{N}/u);
    expect(initialsFromEmail("")).toBe(NO_INITIALS);
    expect(initialsFromEmail("@example.test")).toBe(NO_INITIALS);
    expect(initialsFromEmail("..@example.test")).toBe(NO_INITIALS);
  });
});
