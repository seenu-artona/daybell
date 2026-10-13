import "server-only";
import { ApiError, PAYOUT_CREATE_CONFLICT, PAYOUT_PLATFORM_SETUP } from "@daybell/api";
import { CARD_PREFIX } from "@daybell/core";
import Stripe from "stripe";
import { StripeCallError, type StripeOutcome, type StripeStage } from "./errors";
import {
  type CheckoutSessionFacts,
  type CheckoutStatus,
  type NewAccount,
  type PaymentsProvider,
  SCHEDULE_SET_KEY,
  type ScheduleRequest,
  type StripeAccountData,
  type StripePayoutData,
} from "./types";

/**
 * The API version Daybell is written against: stripe-node 22.6.2's own default, pinned here rather than in an
 * environment variable (ADR 0020). Upgrading means a new package version, this constant, and the webhook endpoint's
 * version in the Stripe Dashboard together (docs/stripe-staging.md).
 */
export const STRIPE_API_VERSION = "2026-08-26.dahlia" as const;

/**
 * Stripe Accounts v2 settings for every studio account (Seenu, Q1 and Q2; ADR 0020 amendment). Stripe refuses v1
 * account creation for new Connect platforms, so accounts are created with POST /v2/core/accounts:
 * - dashboard "express": the studio gets the Express dashboard (Q2);
 * - fees_collector and losses_collector "application": Daybell pays Stripe's fees (passed on, D98) and carries
 *   negative balances. With losses on the platform and a Stripe dashboard, Stripe computes requirements_collector as
 *   "stripe": Stripe collects and verifies requirements. This is the v2 form of the v1 controller properties Seenu
 *   chose in Q1; dashboard "express" requires both responsibilities on the application.
 */
export const RESPONSIBILITIES = {
  fees_collector: "application",
  losses_collector: "application",
} as const;

/** The configurations each account is onboarded for: merchant (card payments) and recipient (transfers). */
export const CONFIGURATIONS = ["merchant", "recipient"] as const;

/**
 * Stripe error codes that mean Daybell's own platform setup isn't finished (ADR 0020 amendment), e.g. the platform
 * hasn't acknowledged loss liability or submitted its Connect profile. Only Daybell can fix these in the Stripe
 * Dashboard, so the owner is told Daybell's platform setup isn't finished and to contact support (code review N2).
 */
export const PLATFORM_SETUP_CODES = new Set([
  "account_creation_liability_unacknowledged",
  "connect_profile_not_submitted",
  "account_create_activation_required",
  "accounts_v2_access_blocked",
  "capability_not_available_in_country",
  "cross_border_connected_account_creation_not_allowed",
]);

const ERROR_CODE = /^[a-z0-9_]{1,100}$/;
/** A Stripe field path such as configuration.recipient or identity.individual.address[line1]. */
const FIELD_NAME = /^[a-z0-9_.[\]]{1,100}$/;
/** At most this many field names are logged from one error. */
const MAX_FIELDS = 20;

/** Stripe's own identifier, or "none" when there is none, or "other" when it isn't an identifier (never free text). */
const identifier = (value: unknown) =>
  value === undefined || value === null
    ? "none"
    : typeof value === "string" && ERROR_CODE.test(value)
      ? value
      : "other";

/**
 * The field names of a v2 `invalid_fields` error (the list in Stripe's answer, each with a `field` and a `message`):
 * names only, each one Stripe's own path or "other" (never the message, which can echo request data), or "none".
 */
function invalidFieldNames(raw: unknown): string {
  const list = (raw as { invalid_fields?: unknown } | null)?.invalid_fields;
  if (!Array.isArray(list) || list.length === 0) return "none";
  const names = list.slice(0, MAX_FIELDS).map((item: unknown) => {
    const field = (item as { field?: unknown } | null)?.field;
    return typeof field === "string" && FIELD_NAME.test(field) ? field : "other";
  });
  return [...new Set(names)].join(",");
}

/**
 * Stripe errors that mean Stripe refused the request outright, so nothing was made (code review S1): invalid request
 * (400/404), authentication (401), permission (403) and rate limits (429; v1 and v2 classes). Anything else (5xx, a
 * timeout or lost connection, an idempotency conflict while the first request is still running, a non-Stripe error)
 * is "unknown": the request may have taken effect.
 */
const REFUSALS = new Set([
  "StripeInvalidRequestError",
  "StripeAuthenticationError",
  "StripePermissionError",
  "StripeRateLimitError",
  "RateLimitError",
]);

/**
 * Errors carry Stripe's error class, raw type and code only, never its message or the request (they can echo request
 * data), so staging failures are diagnosable from the logs. v2 errors may carry their reason in the raw type rather than
 * the code (stripe-node's generateV2Error; security review 3), so both are logged and both are matched against the
 * platform-setup codes. Anything that isn't one of Stripe's identifiers is logged as "other".
 */
function failed(stage: StripeStage, err: unknown): never {
  const stripeError = err instanceof Stripe.errors.StripeError ? err : null;
  const type = stripeError?.type ?? "unknown";
  const rawType = identifier(stripeError?.rawType);
  const code = identifier(stripeError?.code);
  console.error("stripe_error", stage, type, rawType, code);
  // v2 names the fields it refused (e.g. "the Account must have a contact email"): their names only (step 7c).
  if (code === "invalid_fields" || rawType === "invalid_fields")
    console.error("stripe_invalid_fields", stage, invalidFieldNames(stripeError?.raw));
  const outcome: StripeOutcome = stripeError && REFUSALS.has(type) ? "refused" : "unknown";
  if (PLATFORM_SETUP_CODES.has(code) || PLATFORM_SETUP_CODES.has(rawType))
    throw new StripeCallError(
      "Daybell's Stripe platform setup isn't finished. Please contact Daybell support.",
      stage,
      outcome,
      { form: PAYOUT_PLATFORM_SETUP },
    );
  // The create's idempotency key was used before with other parameters (e.g. the owner's email changed since a failed
  // try; security review N1). Retrying won't help: support finds the account by its daybell_studio_id metadata.
  if (stage === "create" && type === "StripeIdempotencyError")
    throw new StripeCallError("Payout setup needs Daybell support to finish.", stage, outcome, {
      form: PAYOUT_CREATE_CONFLICT,
    });
  throw new StripeCallError("We couldn't reach Stripe. Please try again.", stage, outcome);
}

/** Seconds since the epoch from Stripe v2's RFC 3339 timestamps. */
const epochSeconds = (iso: string) => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms))
    throw new ApiError("internal", "We couldn't reach Stripe. Please try again.");
  return Math.floor(ms / 1000);
};

const idOf = (value: string | { id: string } | null | undefined): string | null =>
  value == null ? null : typeof value === "string" ? value : value.id;

const checkoutStatus = (status: string | null): CheckoutStatus | "other" =>
  status === "open" || status === "complete" || status === "expired" ? status : "other";

/** What the checkout's expansion (payment_intent.latest_charge.balance_transaction) adds, read defensively. */
const expanded = <T extends object>(value: unknown): T | null =>
  value !== null && typeof value === "object" ? (value as T) : null;

/**
 * Stripe's checkout session as Daybell's facts (ADR 0023 §5.2). Never anything else from Stripe's object: the email
 * and the recipient are read for their one use each and never stored here or logged (calls 2, 18).
 */
export function checkoutFacts(session: Stripe.Checkout.Session): CheckoutSessionFacts {
  const intent = expanded<Stripe.PaymentIntent>(session.payment_intent);
  const charge = expanded<Stripe.Charge>(intent?.latest_charge);
  const balance = expanded<Stripe.BalanceTransaction>(charge?.balance_transaction);
  const ship = session.collected_information?.shipping_details ?? null;
  return {
    id: session.id,
    status: checkoutStatus(session.status),
    paymentStatus: session.payment_status,
    livemode: session.livemode,
    url: session.url,
    expiresAt: session.expires_at,
    currency: session.currency,
    amountSubtotal: session.amount_subtotal,
    amountShipping: session.shipping_cost?.amount_subtotal ?? 0,
    amountTax: session.total_details?.amount_tax ?? null,
    amountTotal: session.amount_total,
    orderId: session.metadata?.daybell_order_id ?? null,
    studioId: session.metadata?.daybell_studio_id ?? null,
    region: session.metadata?.daybell_region ?? null,
    paymentIntentId: idOf(session.payment_intent),
    chargeId: charge?.id ?? idOf(intent?.latest_charge),
    transferId: idOf(charge?.transfer),
    destination: idOf(intent?.transfer_data?.destination),
    onBehalfOf: idOf(intent?.on_behalf_of),
    applicationFeeAmount: intent?.application_fee_amount ?? null,
    balanceTransaction: balance
      ? { id: balance.id, feeCents: balance.fee, currency: balance.currency }
      : null,
    receiptEmail: session.customer_details?.email ?? null,
    shipping: ship
      ? {
          name: ship.name,
          line1: ship.address.line1 ?? "",
          line2: ship.address.line2 ?? null,
          city: ship.address.city ?? "",
          state: ship.address.state ?? null,
          postalCode: ship.address.postal_code ?? "",
          country: ship.address.country ?? "",
        }
      : null,
  };
}

/** Marks Daybell's own reversals of a studio's transfer, so a retry finds the one already made (call 1). */
export const FEE_RECOVERY_PURPOSE = "card_fee";

export function stripeDriver(secretKey: string, livemode: boolean): PaymentsProvider {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });
  const call = <T>(promise: Promise<T>, stage: StripeStage = "other") =>
    promise.catch((err: unknown) => failed(stage, err));

  return {
    driver: "stripe",
    livemode,
    async createAccount({ studioId, region, country, contactEmail, idempotencyKey }: NewAccount) {
      // Canada only in Phase 1 (US payouts not decided; Seenu, Q3): the region guard refuses US studios before this.
      if (country !== "CA")
        throw new ApiError("region_unavailable", "Payouts aren't available here yet.");
      // Country, currency, the owner's sign-in email as contact_email (Stripe requires one with the recipient
      // configuration; Seenu, Oct 12, replacing Claude's Q4 call) and Daybell's ids. No business name or person. The
      // email is never logged and never in metadata or the key. Only the create: the payout schedule is a separate
      // step, after Daybell has recorded the account (security review 1).
      const created = await call(
        stripe.v2.core.accounts.create(
          {
            contact_email: contactEmail,
            identity: { country: "ca" },
            dashboard: "express",
            defaults: { currency: "cad", responsibilities: RESPONSIBILITIES },
            configuration: {
              // card_payments for D106's destination charges on_behalf_of the Canadian studio (merchant of record);
              // stripe_transfers (v1 "transfers") so destination charges can reach the account (step 10).
              merchant: { capabilities: { card_payments: { requested: true } } },
              recipient: {
                capabilities: { stripe_balance: { stripe_transfers: { requested: true } } },
              },
            },
            metadata: { daybell_studio_id: studioId, daybell_region: region },
          },
          { idempotencyKey },
        ),
        "create",
      );
      return { id: created.id };
    },
    /**
     * Accounts v1 endpoints still take a v2 account's id ("the response is structured as a v1 Account, but any updates
     * still apply to the v2 object"; docs.stripe.com/connect/accounts-v2). Daybell reads and updates through v1 because
     * the payout schedule exists only there (Accounts v2 has no payout settings in stripe-node 22.6.2), and one v1 read
     * gives the flags, requirements, schedule and metadata the facts mapping already uses.
     */
    async retrieveAccount(accountId) {
      return (await call(stripe.accounts.retrieve(accountId))) as StripeAccountData;
    },
    async createAccountLink({ accountId, refreshUrl, returnUrl }) {
      // Accounts v2 links. account_onboarding also continues an unfinished one, and is used for "Update details" too
      // (as with v1, where account_update isn't allowed for accounts with a Stripe-hosted dashboard).
      const link = await call(
        stripe.v2.core.accountLinks.create({
          account: accountId,
          use_case: {
            type: "account_onboarding",
            account_onboarding: {
              configurations: [...CONFIGURATIONS],
              refresh_url: refreshUrl,
              return_url: returnUrl,
            },
          },
        }),
      );
      return { url: link.url, expiresAt: epochSeconds(link.expires_at) };
    },
    async updatePayoutSchedule(accountId, schedule: ScheduleRequest) {
      const params =
        schedule.interval === "weekly"
          ? { interval: "weekly" as const, weekly_anchor: schedule.weeklyAnchor }
          : schedule.interval === "monthly"
            ? { interval: "monthly" as const, monthly_anchor: schedule.monthlyAnchor }
            : { interval: "daily" as const };
      // v1 metadata updates merge keys, so the studio and region ids stay.
      return (await call(
        stripe.accounts.update(accountId, {
          settings: { payouts: { schedule: params } },
          metadata: { [SCHEDULE_SET_KEY]: "true" },
        }),
        "schedule",
      )) as StripeAccountData;
    },
    async retrievePayout(accountId, payoutId) {
      return (await call(
        stripe.payouts.retrieve(payoutId, {}, { stripeContext: accountId }),
      )) as StripePayoutData;
    },
    async createLoginLink(accountId) {
      // v1 only: Accounts v2 has no login links in stripe-node 22.6.2. Express dashboard accounts only.
      const link = await call(stripe.accounts.createLoginLink(accountId));
      return { url: link.url };
    },

    // ── Checkout (ADR 0023) ──────────────────────────────────────────────────────────────────────────────────────
    async createCheckoutSession(params, idempotencyKey) {
      const session = await call(stripe.checkout.sessions.create(params, { idempotencyKey }));
      // A hosted checkout always has its address; anything else can't be sent to a parent.
      if (!session.url)
        throw new StripeCallError(
          "We couldn't reach Stripe. Please try again.",
          "other",
          "unknown",
        );
      return { id: session.id, url: session.url, expiresAt: session.expires_at };
    },
    async retrieveCheckoutSession(sessionId) {
      // The payment, its charge and the charge's balance transaction (Stripe's fee) in one read.
      const session = await call(
        stripe.checkout.sessions.retrieve(sessionId, {
          expand: ["payment_intent.latest_charge.balance_transaction"],
        }),
      );
      return checkoutFacts(session);
    },
    async expireCheckoutSession(sessionId) {
      try {
        const session = await stripe.checkout.sessions.expire(sessionId);
        return { status: checkoutStatus(session.status) };
      } catch (err) {
        // Only an open checkout can be expired: Stripe refuses one already complete or expired, so its state is read.
        if (err instanceof Stripe.errors.StripeError && err.type === "StripeInvalidRequestError") {
          const session = await call(stripe.checkout.sessions.retrieve(sessionId));
          if (session.status !== "open") return { status: checkoutStatus(session.status) };
        }
        return failed("other", err);
      }
    },
    async setReceiptEmail(paymentIntentId, email) {
      await call(
        stripe.paymentIntents.update(
          paymentIntentId,
          { receipt_email: email },
          { idempotencyKey: `daybell-receipt-${paymentIntentId}` },
        ),
      );
    },
    async recoverCardFee({ transferId, amountCents, orderId }) {
      // Once per order: a reversal made by an earlier try (even more than a day ago, when Stripe's idempotency key has
      // expired) is found by its metadata first.
      const earlier = await call(stripe.transfers.listReversals(transferId, { limit: 100 }));
      const found = earlier.data.find(
        (r) =>
          r.metadata?.daybell_order_id === orderId &&
          r.metadata?.daybell_purpose === FEE_RECOVERY_PURPOSE,
      );
      if (found) return { reversalId: found.id };
      const reversal = await call(
        stripe.transfers.createReversal(
          transferId,
          {
            amount: amountCents,
            metadata: { daybell_order_id: orderId, daybell_purpose: FEE_RECOVERY_PURPOSE },
          },
          { idempotencyKey: `daybell-fee-recovery-${orderId}` },
        ),
      );
      return { reversalId: reversal.id };
    },
    async setCardPrefix(accountId) {
      await call(
        stripe.accounts.update(accountId, {
          settings: { card_payments: { statement_descriptor_prefix: CARD_PREFIX } },
        }),
      );
    },

    // ── Taxes (answer 2; calls 3, 6), in the studio's own account ─────────────────────────────────────────────────
    async setTaxHeadOffice(accountId, address) {
      await call(
        stripe.tax.settings.update(
          {
            head_office: {
              address: {
                line1: address.line1,
                ...(address.line2 ? { line2: address.line2 } : {}),
                city: address.city,
                state: address.province,
                postal_code: address.postalCode,
                country: "CA",
              },
            },
          },
          { stripeContext: accountId },
        ),
      );
    },
    async createTaxRegistration(accountId, registration, idempotencyKey) {
      const created = await call(
        stripe.tax.registrations.create(
          {
            country: "CA",
            active_from: "now",
            country_options: {
              ca:
                registration.kind === "gst_hst"
                  ? { type: "standard" }
                  : {
                      type: "province_standard",
                      province_standard: { province: registration.province },
                    },
            },
          },
          { stripeContext: accountId, idempotencyKey },
        ),
      );
      return { id: created.id };
    },
    async expireTaxRegistration(accountId, registrationId) {
      await call(
        stripe.tax.registrations.update(
          registrationId,
          { expires_at: "now" },
          { stripeContext: accountId },
        ),
      );
    },
  };
}
