/**
 * Job templates (D154; ADR 0029): the rules a new job starts with. A job copies its template's rules when it is made
 * and keeps what it was given, so a template change reaches new jobs only, and the job's own changes are the rules
 * that differ from what it was given (D152: "Changed for this job · Undo", "N changes for this job").
 *
 * Rules, counted from picture day: QR cards ready N days before it (or no day planned); the shop opens when its photos
 * are checked, or N days after picture day; the shop closes N days after it opens, or when someone closes it. The
 * database checks the same limits (job_templates and jobs checks).
 */
import type { JobStatus } from "./jobs";

export const SHOP_OPENS = ["photosChecked", "afterPictureDay"] as const;
export type ShopOpens = (typeof SHOP_OPENS)[number];

export interface JobRules {
  /** QR cards ready this many days before picture day; null: no day planned. */
  qrCardsDaysBefore: number | null;
  shopOpens: ShopOpens;
  /** Days after picture day, when the shop opens then; null otherwise. */
  shopOpensDays: number | null;
  /** The shop closes this many days after it first opens; null: when someone closes it. */
  shopClosesDays: number | null;
}

export const RULE_LIMITS = {
  qrCardsDaysBefore: { min: 0, max: 60 },
  shopOpensDays: { min: 0, max: 180 },
  shopClosesDays: { min: 1, max: 365 },
} as const;

/** Today's behaviour, which every studio's first template keeps (ADR 0029, call 1). */
export const DEFAULT_RULES: JobRules = {
  qrCardsDaysBefore: null,
  shopOpens: "photosChecked",
  shopOpensDays: null,
  shopClosesDays: null,
};

/** The rules a person can change on a job (and so undo): one per step that has one. */
export const RULE_KEYS = ["qrCards", "shopOpens", "shopCloses"] as const;
export type RuleKey = (typeof RULE_KEYS)[number];

/** The rule fields each rule key covers. */
export const RULE_FIELDS: Record<RuleKey, readonly (keyof JobRules)[]> = {
  qrCards: ["qrCardsDaysBefore"],
  shopOpens: ["shopOpens", "shopOpensDays"],
  shopCloses: ["shopClosesDays"],
};

const within = (value: number | null, limits: { min: number; max: number }) =>
  value === null || (Number.isInteger(value) && value >= limits.min && value <= limits.max);

/** Whether a set of rules is whole: days in range, and days after picture day exactly when the shop opens then. */
export function rulesValid(rules: JobRules): boolean {
  return (
    within(rules.qrCardsDaysBefore, RULE_LIMITS.qrCardsDaysBefore) &&
    within(rules.shopOpensDays, RULE_LIMITS.shopOpensDays) &&
    within(rules.shopClosesDays, RULE_LIMITS.shopClosesDays) &&
    (rules.shopOpens === "afterPictureDay") === (rules.shopOpensDays !== null)
  );
}

/** The calendar day `days` after (or before, if negative) a YYYY-MM-DD day. */
export function addDays(day: string, days: number): string {
  const at = new Date(Date.parse(`${day}T00:00:00Z`) + days * 86_400_000);
  return at.toISOString().slice(0, 10);
}

/** The days a job's rules plan from its picture day: QR cards ready, and the shop opening (when it is a day). */
export function plannedDays(
  rules: JobRules,
  pictureDay: string,
): { qrCards: string | null; shopOpens: string | null } {
  return {
    qrCards:
      rules.qrCardsDaysBefore === null ? null : addDays(pictureDay, -rules.qrCardsDaysBefore),
    shopOpens:
      rules.shopOpens === "afterPictureDay" && rules.shopOpensDays !== null
        ? addDays(pictureDay, rules.shopOpensDays)
        : null,
  };
}

/** When a shop that opened at `openedAt` closes under these rules: null without a closing rule or an opening. */
export function closesAtByRule(
  rules: Pick<JobRules, "shopClosesDays">,
  openedAt: string | null,
): Date | null {
  if (rules.shopClosesDays === null || openedAt === null) return null;
  const opened = Date.parse(openedAt);
  return Number.isFinite(opened) ? new Date(opened + rules.shopClosesDays * 86_400_000) : null;
}

/** Closing moments this close count as the same (the database and the browser round differently). */
const SAME_MOMENT_MS = 60_000;

export interface ClosingFacts {
  status: JobStatus;
  /** When the shop first opened; null while a draft (and for shops opened before templates). */
  openedAt: string | null;
  closesAt: string | null;
}

/**
 * The rules that differ from what the job's template gave it (D152). A job made before templates (`given` null) has
 * nothing to differ from. While the shop sells, a closing date other than the one the template's rule gives counts as
 * a change to "Shop closes" too (a date is changed on its own step).
 */
export function changedRules(
  rules: JobRules,
  given: JobRules | null,
  closing: ClosingFacts,
): RuleKey[] {
  if (!given) return [];
  const differs = (key: RuleKey) => RULE_FIELDS[key].some((field) => rules[field] !== given[field]);
  return RULE_KEYS.filter((key) => {
    if (differs(key)) return true;
    if (key !== "shopCloses" || closing.status !== "selling") return false;
    const expected = closesAtByRule(given, closing.openedAt);
    const actual = closing.closesAt === null ? null : Date.parse(closing.closesAt);
    if (expected === null || actual === null) return expected !== actual;
    return Math.abs(expected.getTime() - actual) > SAME_MOMENT_MS;
  });
}

/**
 * What undoing a rule change sets: the rule's fields as the template gave them and, while the shop sells, the closing
 * date the template's rule gives (null when it has none). `closesAtPassed` when that date has already gone by: the
 * undo can't set it (the person changes the date instead).
 */
export function undoRule(
  key: RuleKey,
  given: JobRules,
  closing: ClosingFacts,
  now: Date = new Date(),
): { rules: Partial<JobRules>; closesAt?: string | null; closesAtPassed: boolean } {
  const rules = Object.fromEntries(RULE_FIELDS[key].map((f) => [f, given[f]])) as Partial<JobRules>;
  if (key !== "shopCloses" || closing.status !== "selling") return { rules, closesAtPassed: false };
  const expected = closesAtByRule(given, closing.openedAt);
  if (expected !== null && expected.getTime() <= now.getTime())
    return { rules, closesAtPassed: true };
  return { rules, closesAt: expected?.toISOString() ?? null, closesAtPassed: false };
}
