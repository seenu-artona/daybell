import type { DataRegion } from "@daybell/config";
import type { PayoutWeekdayChoice } from "@daybell/core";

/**
 * The parts of Stripe's objects Daybell reads (ADR 0020). Structural, so Stripe's own types fit and the fake driver
 * can make them; anything personal (names, emails, addresses, bank accounts) is never read.
 */
export interface StripeSchedule {
  interval: string;
  delay_days: number;
  weekly_anchor?: string | null;
  weekly_payout_days?: string[] | null;
  monthly_anchor?: number | null;
  monthly_payout_days?: number[] | null;
}

export interface StripeAccountData {
  id: string;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  requirements?: {
    currently_due: string[] | null;
    past_due: string[] | null;
    pending_verification: string[] | null;
    disabled_reason: string | null;
    current_deadline: number | null;
  } | null;
  settings?: { payouts?: { schedule: StripeSchedule } | null } | null;
  metadata?: Record<string, string> | null;
}

export interface StripePayoutData {
  id: string;
  amount: number;
  currency: string;
  status: string;
  method: string;
  automatic: boolean;
  arrival_date: number;
  failure_code: string | null;
  created: number;
}

/** What Daybell asks Stripe to set: the owner's choice, never a delay (Stripe's default delay stays; Seenu, Q6). */
export type ScheduleRequest =
  | { interval: "daily" }
  | { interval: "weekly"; weeklyAnchor: PayoutWeekdayChoice }
  | { interval: "monthly"; monthlyAnchor: number };

/** Daybell's default schedule for a new account: weekly on Friday, Stripe's own delay (D56; Seenu, Q6). */
export const DEFAULT_SCHEDULE: ScheduleRequest = { interval: "weekly", weeklyAnchor: "friday" };

/**
 * Set to "true" in an account's metadata whenever Daybell sets its payout schedule (security review 1). A new account
 * doesn't have it until Daybell's default schedule has been set, so the onboarding route, refresh and the webhook can
 * set the default later if the first try failed, without ever overwriting a schedule the owner chose.
 */
export const SCHEDULE_SET_KEY = "daybell_schedule_set";

export interface NewAccount {
  studioId: string;
  region: DataRegion;
  /** ISO country of the studio's region. Only CA is created in Phase 1 (Seenu, Q3); the drivers refuse US. */
  country: "CA" | "US";
  /**
   * The owner's sign-in email, sent as the v2 account's contact_email: Stripe requires one with the recipient
   * configuration (Seenu, Oct 12, replacing Claude's Q4 call; ADR 0020 section 16). From the verified auth user, never
   * the request. Personal data: never logged, and never in metadata, events, URLs or the idempotency key.
   */
  contactEmail: string;
  /**
   * Stripe's idempotency key, so a retried request never makes a second account. Accounts v2 replays a successful
   * create for 30 days and re-executes a failed one (docs.stripe.com/api-v2-overview).
   */
  idempotencyKey: string;
}

/**
 * Every call Daybell makes to Stripe, behind one interface with two drivers (ADR 0020): `stripe` (stripe-node) and
 * `fake` (in memory, for development, CI and end-to-end tests; refused on Vercel).
 */
export interface PaymentsProvider {
  readonly driver: "stripe" | "fake";
  /** Whether the key is a live-mode key; webhook events must match. */
  readonly livemode: boolean;
  /**
   * Creates the studio's account (Accounts v2) and returns its id only: nothing else is set in the same step, so a
   * later failure can never leave an account Daybell hasn't recorded (security review 1). The payout schedule is set
   * afterwards with updatePayoutSchedule.
   */
  createAccount(input: NewAccount): Promise<{ id: string }>;
  retrieveAccount(accountId: string): Promise<StripeAccountData>;
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: number }>;
  /** Sets the schedule and marks it as set by Daybell (SCHEDULE_SET_KEY in the account's metadata). */
  updatePayoutSchedule(accountId: string, schedule: ScheduleRequest): Promise<StripeAccountData>;
  retrievePayout(accountId: string, payoutId: string): Promise<StripePayoutData>;
  createLoginLink(accountId: string): Promise<{ url: string }>;
}
