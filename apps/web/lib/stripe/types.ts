import type { DataRegion } from "@daybell/config";
import type { PayoutWeekdayChoice, PstProvince } from "@daybell/core";
import type Stripe from "stripe";

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

// ── Checkout (Phase 1 step 10, ADR 0023) ────────────────────────────────────────────────────────────────────────

/**
 * The parameters of a hosted checkout, exactly as Stripe takes them (stripe-node's own type, so the compiler checks
 * every field against stripe-node 22.6.2). Built by lib/checkout/stripe-params.ts only.
 */
export type CheckoutSessionParams = Stripe.Checkout.SessionCreateParams;

/** A checkout's state at Stripe. */
export type CheckoutStatus = "open" | "complete" | "expired";

/**
 * What Daybell reads back from a checkout (ADR 0023 §5.2): ids, amounts, the destination and Daybell's fee, and Stripe's
 * own fee once its balance transaction exists. Two personal fields are held in memory only, for one purpose each, and
 * never stored by the API, logged, or put in an event: the email the parent typed (Stripe's receipt, call 18) and the
 * home delivery recipient (handed to the database for the studio's fulfilment, call 2).
 */
export interface CheckoutSessionFacts {
  id: string;
  status: CheckoutStatus | "other";
  /** Stripe's payment_status: "paid" once the money is taken. */
  paymentStatus: string;
  livemode: boolean;
  url: string | null;
  /** Seconds since the epoch. */
  expiresAt: number;
  currency: string | null;
  amountSubtotal: number | null;
  /** Shipping before tax (shipping_cost.amount_subtotal); 0 without shipping. */
  amountShipping: number;
  amountTax: number | null;
  amountTotal: number | null;
  /** Daybell's ids, from the session's metadata. */
  orderId: string | null;
  studioId: string | null;
  region: string | null;
  paymentIntentId: string | null;
  chargeId: string | null;
  transferId: string | null;
  destination: string | null;
  applicationFeeAmount: number | null;
  /** Stripe's fee for the charge, once its balance transaction exists (call 1). */
  balanceTransaction: { id: string; feeCents: number; currency: string } | null;
  /** In memory only (call 18). */
  receiptEmail: string | null;
  /** In memory only (call 2). */
  shipping: {
    name: string;
    line1: string;
    line2: string | null;
    city: string;
    state: string | null;
    postalCode: string;
    country: string;
  } | null;
}

/** The studio's business address, sent to Stripe as its tax head office (call 3). */
export interface TaxHeadOffice {
  line1: string;
  line2: string | null;
  city: string;
  province: string;
  postalCode: string;
}

/** A Canadian registration as Stripe takes it: GST/HST is "standard", PST "province_standard" (answer 2). */
export type TaxRegistrationRequest = { kind: "gst_hst" } | { kind: "pst"; province: PstProvince };

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

  // Checkout (ADR 0023).
  /** Creates the hosted checkout; the key makes a retry return the same one. */
  createCheckoutSession(
    params: CheckoutSessionParams,
    idempotencyKey: string,
  ): Promise<{ id: string; url: string; expiresAt: number }>;
  /** Reads a checkout with its payment, charge and Stripe's fee. */
  retrieveCheckoutSession(sessionId: string): Promise<CheckoutSessionFacts>;
  /** Expires an open checkout; one already complete or expired answers with its state. */
  expireCheckoutSession(sessionId: string): Promise<{ status: CheckoutStatus | "other" }>;
  /** Stripe emails its receipt there (call 18). The email is never logged. */
  setReceiptEmail(paymentIntentId: string, email: string): Promise<void>;
  /**
   * Recovers Stripe's fee from the studio's transfer (call 1): a partial reversal, once per order whatever the retries
   * (an earlier reversal for the order is found by its metadata and returned).
   */
  recoverCardFee(input: {
    transferId: string;
    amountCents: number;
    orderId: string;
  }): Promise<{ reversalId: string }>;
  /** Sets the account's card statement prefix to "DBL" (call 7). */
  setCardPrefix(accountId: string): Promise<void>;

  // Taxes (answer 2; calls 3, 6). In the studio's account.
  setTaxHeadOffice(accountId: string, address: TaxHeadOffice): Promise<void>;
  createTaxRegistration(
    accountId: string,
    registration: TaxRegistrationRequest,
    idempotencyKey: string,
  ): Promise<{ id: string }>;
  expireTaxRegistration(accountId: string, registrationId: string): Promise<void>;
}
