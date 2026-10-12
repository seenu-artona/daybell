/**
 * Payouts with Stripe Connect (Phase 1 step 7; D56, D98, D106, D143; ADR 0020). Pure rules shared by the API, the
 * screens and the database copy: the account's status in Seenu's five words, when "Payouts connected" ticks, and the
 * next scheduled payout day.
 */

/**
 * A payout account's status (Seenu, answer 4). "Not started" is no account at all, so it isn't stored. The SQL enum
 * public.payout_account_status has the same values in the same order.
 */
export const PAYOUT_ACCOUNT_STATUSES = [
  "needs_info",
  "pending_verification",
  "active",
  "restricted",
] as const;
export type PayoutAccountStatus = (typeof PAYOUT_ACCOUNT_STATUSES)[number];

/**
 * How often Stripe pays out, as Stripe names it. `manual` is mirrored only so a copy never fails: Daybell never
 * offers it (the screens call it "Manual payouts").
 */
export const PAYOUT_INTERVALS = ["daily", "weekly", "monthly", "manual"] as const;
export type PayoutInterval = (typeof PAYOUT_INTERVALS)[number];

/** What a studio may choose (Seenu, answer 3): weekly is the default (D56). */
export const PAYOUT_INTERVAL_CHOICES = ["weekly", "daily", "monthly"] as const;
export type PayoutIntervalChoice = (typeof PAYOUT_INTERVAL_CHOICES)[number];

/** Every day Stripe can name; the copy mirrors whatever Stripe says. */
export const PAYOUT_WEEKDAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
] as const;
export type PayoutWeekday = (typeof PAYOUT_WEEKDAYS)[number];

/** The weekdays a studio picks from for weekly payouts (Seenu, Q6: "weekday", Friday by default). */
export const PAYOUT_WEEKDAY_CHOICES = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
] as const;
export type PayoutWeekdayChoice = (typeof PAYOUT_WEEKDAY_CHOICES)[number];

export const DEFAULT_WEEKLY_ANCHOR: PayoutWeekdayChoice = "friday";
/** Monthly payouts default to the 1st (Seenu, Q6). Stripe pays 29–31 on the last day of shorter months. */
export const DEFAULT_MONTHLY_ANCHOR = 1;

export const PAYOUT_STATUSES = ["pending", "in_transit", "paid", "failed", "canceled"] as const;
export type PayoutStatus = (typeof PAYOUT_STATUSES)[number];

export const PAYOUT_METHODS = ["standard", "instant"] as const;
export type PayoutMethod = (typeof PAYOUT_METHODS)[number];

export interface PayoutSchedule {
  interval: PayoutInterval;
  /** Set exactly when the interval is weekly. */
  weeklyAnchor: PayoutWeekday | null;
  /** 1–31, set exactly when the interval is monthly. */
  monthlyAnchor: number | null;
}

/** What Daybell keeps of a Stripe account: flags, counts and Stripe's reason code; never names, banks or addresses. */
export interface PayoutAccountFacts {
  detailsSubmitted: boolean;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
  /** Stripe's requirements.disabled_reason code, e.g. "requirements.past_due". */
  disabledReason: string | null;
  /** How many requirements are currently due, past due and pending verification (counts only). */
  currentlyDue: number;
  pastDue: number;
  pendingVerification: number;
}

/** Stripe's reasons that mean Stripe or Daybell stopped the account, not that something is simply missing. */
function stopped(reason: string | null): boolean {
  return (
    reason !== null &&
    (reason.startsWith("rejected.") ||
      reason === "listed" ||
      reason === "platform_paused" ||
      reason === "other")
  );
}

/**
 * The status in Seenu's words, from Stripe's facts (ADR 0020). In order:
 * 1. restricted: Stripe rejected or paused the account (rejected.*, listed, platform_paused, other);
 * 2. active: card payments and payouts are enabled and nothing is due or past due (Seenu, Q5);
 * 3. needs info: onboarding isn't finished (details not submitted);
 * 4. restricted: details were submitted but something is past due, so Stripe has turned something off;
 * 5. needs info: something is due now (or Stripe asks for capabilities);
 * 6. pending verification: everything is in and Stripe is checking it (or hasn't enabled the account yet).
 * Pure: the same facts always give the same status, so events arriving out of order can't confuse it.
 */
export function payoutAccountStatus(f: PayoutAccountFacts): PayoutAccountStatus {
  if (stopped(f.disabledReason)) return "restricted";
  if (f.chargesEnabled && f.payoutsEnabled && f.currentlyDue === 0 && f.pastDue === 0)
    return "active";
  if (!f.detailsSubmitted) return "needs_info";
  if (f.pastDue > 0) return "restricted";
  if (f.currentlyDue > 0 || f.disabledReason === "action_required.requested_capabilities")
    return "needs_info";
  return "pending_verification";
}

/** "Set up payouts" and "Payouts connected" tick only when the account is Active (Seenu, Q5). */
export function payoutsConnected(status: PayoutAccountStatus | null | undefined): boolean {
  return status === "active";
}

/** Only the owner connects or changes payouts; admins read; photographers and staff don't see them (answer 1). */
export function canManagePayouts(role: string): boolean {
  return role === "owner";
}

export function canSeePayouts(role: string): boolean {
  return role === "owner" || role === "admin";
}

const DAY_MS = 86_400_000;
const WEEKDAY_INDEX: Record<PayoutWeekday, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
const daysInMonth = (year: number, month: number) =>
  new Date(Date.UTC(year, month + 1, 0)).getUTCDate();

/**
 * The next day the schedule pays out on, from `today` (YYYY-MM-DD) on, as YYYY-MM-DD; null for daily and manual
 * payouts (every business day, or none). Monthly anchors past a short month's end fall on its last day, as Stripe
 * does. Stripe only pays out when there is money to pay, after its delay, so this is the schedule's day, not a promise.
 */
export function nextPayoutDay(schedule: PayoutSchedule, today: string): string | null {
  const start = Date.parse(`${today}T00:00:00Z`);
  if (Number.isNaN(start)) return null;
  if (schedule.interval === "weekly" && schedule.weeklyAnchor) {
    const ahead = (WEEKDAY_INDEX[schedule.weeklyAnchor] - new Date(start).getUTCDay() + 7) % 7;
    return isoDay(start + ahead * DAY_MS);
  }
  if (schedule.interval === "monthly" && schedule.monthlyAnchor) {
    const date = new Date(start);
    for (const offset of [0, 1]) {
      const year = date.getUTCFullYear() + Math.floor((date.getUTCMonth() + offset) / 12);
      const month = (date.getUTCMonth() + offset) % 12;
      const day = Math.min(schedule.monthlyAnchor, daysInMonth(year, month));
      const candidate = Date.UTC(year, month, day);
      if (candidate >= start) return isoDay(candidate);
    }
  }
  return null;
}

/** Basis points as a plain percentage without a float: 290 → "2.9", 300 → "3", 25 → "0.25". */
export function formatBasisPoints(basisPoints: number): string {
  if (!Number.isSafeInteger(basisPoints) || basisPoints < 0)
    throw new Error("Basis points must be a whole number");
  const whole = Math.floor(basisPoints / 100);
  const fraction = String(basisPoints % 100)
    .padStart(2, "0")
    .replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : String(whole);
}
