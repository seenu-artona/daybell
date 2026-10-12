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

export interface NewAccount {
  studioId: string;
  region: DataRegion;
  /** ISO country of the studio's region (CA in Phase 1). */
  country: "CA" | "US";
  /** Stripe's idempotency key, so a retried request never makes a second account. */
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
  createAccount(input: NewAccount): Promise<StripeAccountData>;
  retrieveAccount(accountId: string): Promise<StripeAccountData>;
  createAccountLink(input: {
    accountId: string;
    refreshUrl: string;
    returnUrl: string;
  }): Promise<{ url: string; expiresAt: number }>;
  updatePayoutSchedule(accountId: string, schedule: ScheduleRequest): Promise<StripeAccountData>;
  retrievePayout(accountId: string, payoutId: string): Promise<StripePayoutData>;
  createLoginLink(accountId: string): Promise<{ url: string }>;
}
