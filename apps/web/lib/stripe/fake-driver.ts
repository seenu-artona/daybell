import "server-only";
import { randomBytes } from "node:crypto";
import { siteUrl } from "@daybell/config";
import type {
  PaymentsProvider,
  ScheduleRequest,
  StripeAccountData,
  StripePayoutData,
} from "./types";

/**
 * The fake Stripe (STRIPE_DRIVER=fake; ADR 0020): development, CI and end-to-end tests only, refused on Vercel. It
 * keeps accounts and payouts in this server process's memory (one `next start` in end-to-end tests), behaves like the
 * parts of Stripe Daybell uses, and sends its "hosted onboarding" to /dev/stripe-onboarding. Ids look like Stripe's.
 * Like the real driver since the Accounts v2 move (ADR 0020 amendment), a new account comes back as Daybell reads it
 * through v1: needing its details, with the default schedule (weekly on Friday) already set.
 */
interface FakeState {
  accounts: Map<string, StripeAccountData>;
  idempotency: Map<string, string>;
  payouts: Map<string, StripePayoutData & { account: string }>;
  returnUrls: Map<string, string>;
}

const STATE = Symbol.for("daybell.fakeStripe");

function state(): FakeState {
  const g = globalThis as { [STATE]?: FakeState };
  g[STATE] ??= {
    accounts: new Map(),
    idempotency: new Map(),
    payouts: new Map(),
    returnUrls: new Map(),
  };
  return g[STATE];
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function fakeId(prefix: "acct" | "po" | "evt"): string {
  return `${prefix}_fake${Array.from(randomBytes(16), (b) => ALPHANUMERIC[b % ALPHANUMERIC.length]).join("")}`;
}

const DUE = [
  "business_profile.url",
  "external_account",
  "representative.first_name",
  "tos_acceptance.date",
];

function account(id: string): StripeAccountData {
  const found = state().accounts.get(id);
  if (!found) throw new Error("fake_stripe_no_account");
  return found;
}

export function fakeDriver(): PaymentsProvider {
  return {
    driver: "fake",
    livemode: false,
    async createAccount({ studioId, region, idempotencyKey }) {
      const s = state();
      const known = s.idempotency.get(idempotencyKey);
      if (known) return account(known);
      const id = fakeId("acct");
      s.accounts.set(id, {
        id,
        details_submitted: false,
        charges_enabled: false,
        payouts_enabled: false,
        requirements: {
          currently_due: [...DUE],
          past_due: [...DUE],
          pending_verification: [],
          disabled_reason: "requirements.past_due",
          current_deadline: null,
        },
        settings: {
          payouts: { schedule: { interval: "weekly", weekly_anchor: "friday", delay_days: 2 } },
        },
        metadata: { daybell_studio_id: studioId, daybell_region: region },
      });
      s.idempotency.set(idempotencyKey, id);
      return account(id);
    },
    async retrieveAccount(accountId) {
      return account(accountId);
    },
    async createAccountLink({ accountId, returnUrl }) {
      account(accountId);
      state().returnUrls.set(accountId, returnUrl);
      return {
        url: `${siteUrl()}/dev/stripe-onboarding?account=${accountId}`,
        expiresAt: Math.floor(Date.now() / 1000) + 300,
      };
    },
    async updatePayoutSchedule(accountId, schedule: ScheduleRequest) {
      const a = account(accountId);
      const delay = a.settings?.payouts?.schedule.delay_days ?? 2;
      const next =
        schedule.interval === "weekly"
          ? { interval: "weekly", weekly_anchor: schedule.weeklyAnchor, delay_days: delay }
          : schedule.interval === "monthly"
            ? { interval: "monthly", monthly_anchor: schedule.monthlyAnchor, delay_days: delay }
            : { interval: "daily", delay_days: delay };
      a.settings = { payouts: { schedule: next } };
      return a;
    },
    async retrievePayout(accountId, payoutId) {
      const payout = state().payouts.get(payoutId);
      if (!payout || payout.account !== accountId) throw new Error("fake_stripe_no_payout");
      const { account: _account, ...rest } = payout;
      return rest;
    },
    async createLoginLink(accountId) {
      account(accountId);
      return { url: `${siteUrl()}/dev/stripe-onboarding?account=${accountId}&view=dashboard` };
    },
  };
}

/** What the fake onboarding page does: the owner finishes on "Stripe", and the account is enabled. */
export function fakeFinishOnboarding(accountId: string): void {
  const a = account(accountId);
  a.details_submitted = true;
  a.charges_enabled = true;
  a.payouts_enabled = true;
  a.requirements = {
    currently_due: [],
    past_due: [],
    pending_verification: [],
    disabled_reason: null,
    current_deadline: null,
  };
}

/** Where "Stripe" sends the owner back to: the return address of the last link (Daybell's own, from siteUrl()). */
export function fakeReturnUrl(accountId: string): string | null {
  return state().returnUrls.get(accountId) ?? null;
}

/** A payout Stripe has paid to the studio's bank, in the account's currency. */
export function fakePaidPayout(accountId: string, currency: "cad" | "usd"): string {
  account(accountId);
  const id = fakeId("po");
  const now = Math.floor(Date.now() / 1000);
  state().payouts.set(id, {
    id,
    account: accountId,
    amount: 12_345,
    currency,
    status: "paid",
    method: "standard",
    automatic: true,
    arrival_date: now,
    failure_code: null,
    created: now,
  });
  return id;
}

/** True when the account was made by this fake (the dev page refuses anything else). */
export function isFakeAccount(accountId: string): boolean {
  return state().accounts.has(accountId);
}
