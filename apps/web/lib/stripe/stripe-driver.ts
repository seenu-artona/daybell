import "server-only";
import { ApiError } from "@daybell/api";
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
 * Stripe Connect controller properties for every studio account (Seenu, Q1 and Q2; ADR 0020): Stripe collects and
 * verifies requirements, Daybell carries negative balances and pays Stripe's fees (passed on, D98), and the studio
 * gets the Express dashboard.
 */
export const CONTROLLER = {
  requirement_collection: "stripe",
  losses: { payments: "application" },
  fees: { payer: "application" },
  stripe_dashboard: { type: "express" },
} as const;

/** Errors carry Stripe's error type only, never its message (it can echo request data). */
function failed(err: unknown): never {
  const type = err instanceof Stripe.errors.StripeError ? err.type : "unknown";
  console.error("stripe_error", type);
  throw new ApiError("internal", "We couldn't reach Stripe. Please try again.");
}

export function stripeDriver(secretKey: string, livemode: boolean): PaymentsProvider {
  const stripe = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    maxNetworkRetries: 2,
    timeout: 10_000,
    telemetry: false,
  });
  const call = <T>(promise: Promise<T>) => promise.catch(failed);
  return {
    driver: "stripe",
    livemode,
    async createAccount({ studioId, region, country, idempotencyKey }: NewAccount) {
      // Country only: no business name, email or person is sent (Claude's call Q4). Default schedule: weekly on
      // Friday, Stripe's own delay (D56; Seenu, Q6).
      return (await call(
        stripe.accounts.create(
          {
            country,
            controller: CONTROLLER,
            capabilities: { card_payments: { requested: true }, transfers: { requested: true } },
            metadata: { daybell_studio_id: studioId, daybell_region: region },
            settings: { payouts: { schedule: { interval: "weekly", weekly_anchor: "friday" } } },
          },
          { idempotencyKey },
        ),
      )) as StripeAccountData;
    },
    async retrieveAccount(accountId) {
      return (await call(stripe.accounts.retrieve(accountId))) as StripeAccountData;
    },
    async createAccountLink({ accountId, refreshUrl, returnUrl }) {
      // account_onboarding also continues an unfinished one; account_update isn't allowed for accounts with a
      // Stripe-hosted dashboard (stripe-node's AccountLinkCreateParams.type).
      const link = await call(
        stripe.accountLinks.create({
          account: accountId,
          type: "account_onboarding",
          refresh_url: refreshUrl,
          return_url: returnUrl,
        }),
      );
      return { url: link.url, expiresAt: link.expires_at };
    },
    async updatePayoutSchedule(accountId, schedule: ScheduleRequest) {
      const params =
        schedule.interval === "weekly"
          ? { interval: "weekly" as const, weekly_anchor: schedule.weeklyAnchor }
          : schedule.interval === "monthly"
            ? { interval: "monthly" as const, monthly_anchor: schedule.monthlyAnchor }
            : { interval: "daily" as const };
      return (await call(
        stripe.accounts.update(accountId, { settings: { payouts: { schedule: params } } }),
      )) as StripeAccountData;
    },
    async retrievePayout(accountId, payoutId) {
      return (await call(
        stripe.payouts.retrieve(payoutId, {}, { stripeContext: accountId }),
      )) as StripePayoutData;
    },
    async createLoginLink(accountId) {
      const link = await call(stripe.accounts.createLoginLink(accountId));
      return { url: link.url };
    },
  };
}
