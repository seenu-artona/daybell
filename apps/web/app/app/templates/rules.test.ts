import { DEFAULT_RULES, type JobRules } from "@daybell/core";
import { describe, expect, it } from "vitest";
import { ruleChoice, ruleLine, rulePatchFor, templateSentenceValues } from "./rules";

const FALL: JobRules = {
  qrCardsDaysBefore: 5,
  shopOpens: "afterPictureDay",
  shopOpensDays: 7,
  shopClosesDays: 10,
};

describe("rules as they read (D152, D154)", () => {
  it("each rule reads as one of its two choices", () => {
    expect(ruleLine("qrCards", FALL)).toEqual({ message: "qrCards.days", values: { days: 5 } });
    expect(ruleLine("shopOpens", FALL)).toEqual({ message: "shopOpens.days", values: { days: 7 } });
    expect(ruleLine("shopCloses", FALL)).toEqual({
      message: "shopCloses.days",
      values: { days: 10 },
    });
    expect(ruleLine("qrCards", DEFAULT_RULES).message).toBe("qrCards.none");
    expect(ruleLine("shopOpens", DEFAULT_RULES).message).toBe("shopOpens.photosChecked");
    expect(ruleLine("shopCloses", DEFAULT_RULES).message).toBe("shopCloses.byHand");
  });

  it("a dialog starts from the rule as it stands", () => {
    expect(ruleChoice("shopOpens", FALL)).toEqual({ choice: "days", days: 7 });
    expect(ruleChoice("shopCloses", DEFAULT_RULES)).toEqual({ choice: "none", days: null });
  });

  it("a choice becomes a change, and days must be whole and in range", () => {
    expect(rulePatchFor("shopOpens", "none", "")).toEqual({
      shopOpens: "photosChecked",
      shopOpensDays: null,
    });
    expect(rulePatchFor("shopOpens", "days", " 4 ")).toEqual({
      shopOpens: "afterPictureDay",
      shopOpensDays: 4,
    });
    expect(rulePatchFor("shopCloses", "days", "0")).toBeNull();
    expect(rulePatchFor("shopCloses", "days", "365")).toEqual({ shopClosesDays: 365 });
    expect(rulePatchFor("qrCards", "days", "61")).toBeNull();
    expect(rulePatchFor("qrCards", "days", "2.5")).toBeNull();
    expect(rulePatchFor("qrCards", "days", "")).toBeNull();
    expect(rulePatchFor("qrCards", "none", "abc")).toEqual({ qrCardsDaysBefore: null });
  });

  it("the New job dialog says what the template will do", () => {
    expect(templateSentenceValues("School Fall", FALL)).toEqual({
      name: "School Fall",
      opens: "days",
      openDays: 7,
      closes: "days",
      closeDays: 10,
    });
    expect(templateSentenceValues("Standard", DEFAULT_RULES)).toMatchObject({
      opens: "photosChecked",
      closes: "byHand",
    });
  });
});
