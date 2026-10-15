import { describe, expect, it } from "vitest";
import { classLabelValid, cleanClassLabel, DEFAULT_CLASS_LABEL, MAX_CLASS_LABEL } from "./jobs";

describe("the class field's label (ADR 0030, call 29)", () => {
  it("is Class unless a template says otherwise", () => {
    expect(DEFAULT_CLASS_LABEL).toBe("Class");
    expect(MAX_CLASS_LABEL).toBe(30);
  });

  it("is free text of 1 to 30 characters, cleaned of extra spaces", () => {
    expect(cleanClassLabel("  Home   room ")).toBe("Home room");
    expect(classLabelValid("Homeroom")).toBe(true);
    expect(classLabelValid("Team")).toBe(true);
    expect(classLabelValid("")).toBe(false);
    expect(classLabelValid("x".repeat(31))).toBe(false);
    expect(classLabelValid(" Room")).toBe(false);
    expect(classLabelValid("Room\u0007")).toBe(false);
  });
});
