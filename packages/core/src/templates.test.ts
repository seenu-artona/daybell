import { describe, expect, it } from "vitest";
import {
  addDays,
  changedRules,
  closesAtByRule,
  DEFAULT_RULES,
  type JobRules,
  plannedDays,
  RULE_KEYS,
  rulesValid,
  undoRule,
  withRules,
} from "./templates";

const FALL: JobRules = {
  qrCardsDaysBefore: 5,
  shopOpens: "photosChecked",
  shopOpensDays: null,
  shopClosesDays: 10,
};
const OPENED = "2026-10-05T14:00:00.000Z";
const draft = { status: "draft" as const, openedAt: null, closesAt: null };
const selling = (closesAt: string | null) => ({
  status: "selling" as const,
  openedAt: OPENED,
  closesAt,
});

describe("template rules (D154)", () => {
  it("today's defaults plan nothing and close by hand (ADR 0029, call 1)", () => {
    expect(DEFAULT_RULES).toEqual({
      qrCardsDaysBefore: null,
      shopOpens: "photosChecked",
      shopOpensDays: null,
      shopClosesDays: null,
    });
    expect(rulesValid(DEFAULT_RULES)).toBe(true);
  });

  it("checks the database's limits and that days go with 'after picture day'", () => {
    expect(rulesValid(FALL)).toBe(true);
    expect(rulesValid({ ...FALL, shopOpens: "afterPictureDay", shopOpensDays: 7 })).toBe(true);
    expect(rulesValid({ ...FALL, shopOpens: "afterPictureDay", shopOpensDays: null })).toBe(false);
    expect(rulesValid({ ...FALL, shopOpensDays: 3 })).toBe(false);
    expect(rulesValid({ ...FALL, qrCardsDaysBefore: 61 })).toBe(false);
    expect(rulesValid({ ...FALL, qrCardsDaysBefore: -1 })).toBe(false);
    expect(rulesValid({ ...FALL, qrCardsDaysBefore: 1.5 })).toBe(false);
    expect(rulesValid({ ...FALL, shopClosesDays: 0 })).toBe(false);
    expect(rulesValid({ ...FALL, shopClosesDays: 365 })).toBe(true);
    expect(rulesValid({ ...FALL, shopClosesDays: 366 })).toBe(false);
  });

  it("applies a change, dropping the days when the shop opens once photos are checked", () => {
    const later = { ...FALL, shopOpens: "afterPictureDay", shopOpensDays: 7 } as const;
    expect(withRules(later, { shopOpens: "photosChecked" })).toEqual(FALL);
    expect(withRules(FALL, { shopClosesDays: undefined, qrCardsDaysBefore: null })).toEqual({
      ...FALL,
      qrCardsDaysBefore: null,
    });
    // Days named with "photos checked" stay, so the whole is refused rather than quietly fixed.
    expect(rulesValid(withRules(FALL, { shopOpensDays: 3 }))).toBe(false);
  });

  it("plans days from picture day", () => {
    expect(addDays("2026-03-01", -1)).toBe("2026-02-28");
    expect(addDays("2026-12-30", 3)).toBe("2027-01-02");
    expect(plannedDays(FALL, "2026-09-24")).toEqual({ qrCards: "2026-09-19", shopOpens: null });
    expect(
      plannedDays({ ...FALL, shopOpens: "afterPictureDay", shopOpensDays: 11 }, "2026-09-24"),
    ).toEqual({ qrCards: "2026-09-19", shopOpens: "2026-10-05" });
    expect(plannedDays(DEFAULT_RULES, "2026-09-24")).toEqual({ qrCards: null, shopOpens: null });
  });

  it("counts the closing from the shop's first opening", () => {
    expect(closesAtByRule(FALL, OPENED)?.toISOString()).toBe("2026-10-15T14:00:00.000Z");
    expect(closesAtByRule(FALL, null)).toBeNull();
    expect(closesAtByRule(DEFAULT_RULES, OPENED)).toBeNull();
  });
});

describe("changes for this job (D152)", () => {
  it("a job made before templates has nothing to differ from", () => {
    expect(changedRules({ ...FALL, qrCardsDaysBefore: 9 }, null, draft)).toEqual([]);
  });

  it("is the rules that differ from what the template gave", () => {
    expect(changedRules(FALL, FALL, draft)).toEqual([]);
    expect(changedRules({ ...FALL, qrCardsDaysBefore: 3 }, FALL, draft)).toEqual(["qrCards"]);
    expect(
      changedRules({ ...FALL, shopOpens: "afterPictureDay", shopOpensDays: 4 }, FALL, draft),
    ).toEqual(["shopOpens"]);
    expect(changedRules({ ...FALL, shopClosesDays: null }, FALL, draft)).toEqual(["shopCloses"]);
    const all = { qrCardsDaysBefore: 1, shopOpens: "afterPictureDay", shopOpensDays: 2 } as const;
    expect(changedRules({ ...all, shopClosesDays: 3 }, FALL, draft)).toEqual([...RULE_KEYS]);
  });

  it("while selling, a closing date other than the rule's is a change to Shop closes", () => {
    expect(changedRules(FALL, FALL, selling("2026-10-15T14:00:00.000Z"))).toEqual([]);
    // Rounding between the database and the browser doesn't count.
    expect(changedRules(FALL, FALL, selling("2026-10-15T14:00:30.000Z"))).toEqual([]);
    expect(changedRules(FALL, FALL, selling("2026-10-16T04:00:00.000Z"))).toEqual(["shopCloses"]);
    expect(changedRules(FALL, FALL, selling(null), new Date("2026-10-10T00:00:00Z"))).toEqual([
      "shopCloses",
    ]);
    expect(changedRules(DEFAULT_RULES, DEFAULT_RULES, selling("2026-10-16T04:00:00.000Z"))).toEqual(
      ["shopCloses"],
    );
    expect(changedRules(DEFAULT_RULES, DEFAULT_RULES, selling(null))).toEqual([]);
    // Reopened after closing (closing clears the date) once the rule's date has gone by: nobody changed anything.
    const afterRule = new Date("2026-10-20T00:00:00Z");
    expect(changedRules(FALL, FALL, selling(null), afterRule)).toEqual([]);
    // Before the rule's date, a shop with no date was changed (its date was removed).
    expect(changedRules(FALL, FALL, selling(null), new Date("2026-10-10T00:00:00Z"))).toEqual([
      "shopCloses",
    ]);
    // A date set on the reopened shop is still a change.
    expect(changedRules(FALL, FALL, selling("2026-10-30T00:00:00.000Z"), afterRule)).toEqual([
      "shopCloses",
    ]);
    // Once closed, the closing date is history (it is cleared when the shop closes).
    expect(
      changedRules(FALL, FALL, { status: "closed", openedAt: OPENED, closesAt: null }),
    ).toEqual([]);
  });

  it("undo puts the template's rule back, and while selling its closing date", () => {
    expect(undoRule("qrCards", FALL, draft)).toEqual({
      rules: { qrCardsDaysBefore: 5 },
      closesAtPassed: false,
    });
    expect(undoRule("shopOpens", FALL, draft).rules).toEqual({
      shopOpens: "photosChecked",
      shopOpensDays: null,
    });
    const now = new Date("2026-10-10T00:00:00Z");
    expect(undoRule("shopCloses", FALL, selling(null), now)).toEqual({
      rules: { shopClosesDays: 10 },
      closesAt: "2026-10-15T14:00:00.000Z",
      closesAtPassed: false,
    });
    expect(undoRule("shopCloses", DEFAULT_RULES, selling("2026-10-20T00:00:00Z"), now)).toEqual({
      rules: { shopClosesDays: null },
      closesAt: null,
      closesAtPassed: false,
    });
    // The template's date has gone by: the undo can't set a date in the past.
    expect(undoRule("shopCloses", FALL, selling(null), new Date("2026-10-20T00:00:00Z"))).toEqual({
      rules: { shopClosesDays: 10 },
      closesAtPassed: true,
    });
  });
});
