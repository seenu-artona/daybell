import "server-only";
import { ApiError, PAYOUT_PLATFORM_SETUP } from "@daybell/api";
import Stripe from "stripe";
import type {
  NewAccount,
  PaymentsProvider,
  ScheduleRequest,
  StripeAccountData,
  StripePayoutData,
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
 * hasn't acknowledged loss liability or submitted its Connect profile. The owner sees "Stripe needs the platform
 * setup finished"; only Daybell can fix these in the Stripe Dashboard.
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

/**
 * Errors carry Stripe's error type and code only, never its message or the request (they can echo request data), so
 * staging failures are diagnosable from the logs. Codes are Stripe's own identifiers; anything else is "other".
 */
function failed(err: unknown): never {
  const stripeError = err instanceof Stripe.errors.StripeError ? err : null;
  const type = stripeError?.type ?? "unknown";
  const raw = stripeError?.code;
  const code = raw === undefined || raw === null ? "none" : ERROR_CODE.test(raw) ? raw : "other";
  console.error("stripe_error", type, code);
  if (PLATFORM_SETUP_CODES.has(code))
    throw new ApiError("internal", "Stripe needs the platform setup finished.", {
      form: PAYOUT_PLATFORM_SETUP,
    });
  throw new ApiError("internal", "We couldn't reach Stripe. Please try again.");
}

/** Seconds since the epoch from Stripe v2's RFC 3339 timestamps. */
const epochSeconds = (iso: string) => {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms))
    throw new ApiError("internal", "We couldn't reach Stripe. Please try again.");
  return Math.floor(ms / 1000);
};

export function stripeDriver(secretKey: string, livemode: boolean): PaymentsProvider {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });
  const call = <T>(promise: Promise<T>) => promise.catch(failed);

  /**
   * Accounts v1 endpoints still take a v2 account's id ("the response is structured as a v1 Account, but any updates
   * still apply to the v2 object"; docs.stripe.com/connect/accounts-v2). Daybell reads and updates through v1 because
   * the payout schedule exists only there (Accounts v2 has no payout settings in stripe-node 22.6.2), and one v1 read
   * gives the flags, requirements, schedule and metadata the facts mapping already uses.
   */
  const setSchedule = async (accountId: string, schedule: ScheduleRequest) => {
    const params =
      schedule.interval === "weekly"
        ? { interval: "weekly" as const, weekly_anchor: schedule.weeklyAnchor }
        : schedule.interval === "monthly"
          ? { interval: "monthly" as const, monthly_anchor: schedule.monthlyAnchor }
          : { interval: "daily" as const };
    return (await call(
      stripe.accounts.update(accountId, { settings: { payouts: { schedule: params } } }),
    )) as StripeAccountData;
  };

  return {
    driver: "stripe",
    livemode,
    async createAccount({ studioId, region, country, idempotencyKey }: NewAccount) {
      // Country, currency and Daybell's ids only: no business name, email or person is sent (Claude's call Q4).
      const created = await call(
        stripe.v2.core.accounts.create(
          {
            identity: { country: country.toLowerCase() },
            dashboard: "express",
            defaults: {
              currency: country === "CA" ? "cad" : "usd",
              responsibilities: RESPONSIBILITIES,
            },
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
      );
      // Default schedule: weekly on Friday, Stripe's own delay (D56; Seenu, Q6), set through v1 (see setSchedule).
      // If this fails after the account was made, a retry replays the create (same idempotency key) and sets it again;
      // the fixed alert line lets support find the account (its metadata has the studio id) if nobody retries.
      try {
        return await setSchedule(created.id, { interval: "weekly", weeklyAnchor: "friday" });
      } catch (err) {
        console.error("stripe_account_unrecorded", studioId);
        throw err;
      }
    },
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
    updatePayoutSchedule: setSchedule,
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
  };
}
