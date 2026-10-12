import { describe, expect, it } from "vitest";
import { moneyInputClass } from "./money-input-class";

const classes = (invalid: boolean) => moneyInputClass(invalid).split(" ");

describe("moneyInputClass", () => {
  it("uses the normal border and background when the price is valid", () => {
    expect(classes(false)).toEqual(expect.arrayContaining(["border-line-strong", "bg-surface"]));
    expect(classes(false)).not.toContain("border-danger");
  });

  it("swaps them for the danger ones when it isn't, so the error state always shows", () => {
    expect(classes(true)).toEqual(expect.arrayContaining(["border-danger", "bg-danger-soft"]));
    expect(classes(true)).not.toContain("border-line-strong");
    expect(classes(true)).not.toContain("bg-surface");
  });

  it("keeps the 44px touch target and the visible focus either way (D91)", () => {
    for (const invalid of [false, true])
      expect(classes(invalid)).toEqual(
        expect.arrayContaining(["min-h-11", "focus:border-primary"]),
      );
  });
});
