import type { JobRules, RuleKey, RulesPatch } from "@daybell/core";
import { RULE_LIMITS } from "@daybell/core";

/**
 * How a rule reads and is chosen (D152, D154; ADR 0029): each rule is one of two choices, the second with a number of
 * days. Shared by the template page and a job's Progress, so a rule reads the same in both places.
 */
export type RuleChoice = "none" | "days";

/** The locale message (under app.rules) for a rule as it stands, and its values. */
export function ruleLine(
  key: RuleKey,
  rules: JobRules,
): { message: string; values: { days: number } } {
  switch (key) {
    case "qrCards":
      return rules.qrCardsDaysBefore === null
        ? { message: "qrCards.none", values: { days: 0 } }
        : { message: "qrCards.days", values: { days: rules.qrCardsDaysBefore } };
    case "shopOpens":
      return rules.shopOpens === "photosChecked" || rules.shopOpensDays === null
        ? { message: "shopOpens.photosChecked", values: { days: 0 } }
        : { message: "shopOpens.days", values: { days: rules.shopOpensDays } };
    case "shopCloses":
      return rules.shopClosesDays === null
        ? { message: "shopCloses.byHand", values: { days: 0 } }
        : { message: "shopCloses.days", values: { days: rules.shopClosesDays } };
  }
}

/** The rule's current choice and days, for its dialog. */
export function ruleChoice(
  key: RuleKey,
  rules: JobRules,
): { choice: RuleChoice; days: number | null } {
  switch (key) {
    case "qrCards":
      return rules.qrCardsDaysBefore === null
        ? { choice: "none", days: null }
        : { choice: "days", days: rules.qrCardsDaysBefore };
    case "shopOpens":
      return rules.shopOpens === "afterPictureDay"
        ? { choice: "days", days: rules.shopOpensDays }
        : { choice: "none", days: null };
    case "shopCloses":
      return rules.shopClosesDays === null
        ? { choice: "none", days: null }
        : { choice: "days", days: rules.shopClosesDays };
  }
}

/** The days each rule allows. */
export function ruleLimits(key: RuleKey): { min: number; max: number } {
  return key === "qrCards"
    ? RULE_LIMITS.qrCardsDaysBefore
    : key === "shopOpens"
      ? RULE_LIMITS.shopOpensDays
      : RULE_LIMITS.shopClosesDays;
}

/** The change a dialog's choice makes, or null when the days aren't a whole number in range. */
export function rulePatchFor(
  key: RuleKey,
  choice: RuleChoice,
  daysText: string,
): RulesPatch | null {
  let days: number | null = null;
  if (choice === "days") {
    const text = daysText.trim();
    if (!/^\d+$/.test(text)) return null;
    days = Number(text);
    const limits = ruleLimits(key);
    if (days < limits.min || days > limits.max) return null;
  }
  switch (key) {
    case "qrCards":
      return { qrCardsDaysBefore: days };
    case "shopOpens":
      return days === null
        ? { shopOpens: "photosChecked", shopOpensDays: null }
        : { shopOpens: "afterPictureDay", shopOpensDays: days };
    case "shopCloses":
      return { shopClosesDays: days };
  }
}

/** The values of the New job dialog's sentence about a template (app.jobs.form.templateSentence). */
export function templateSentenceValues(name: string, rules: JobRules) {
  return {
    name,
    opens: rules.shopOpens === "afterPictureDay" ? "days" : "photosChecked",
    openDays: rules.shopOpensDays ?? 0,
    closes: rules.shopClosesDays === null ? "byHand" : "days",
    closeDays: rules.shopClosesDays ?? 0,
  };
}
