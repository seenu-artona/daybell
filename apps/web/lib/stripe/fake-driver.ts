import "server-only";
import { randomBytes } from "node:crypto";
import { siteUrl } from "@daybell/config";
import {
  type CheckoutSessionFacts,
  type CheckoutSessionParams,
  type PaymentsProvider,
  SCHEDULE_SET_KEY,
  type ScheduleRequest,
  type StripeAccountData,
  type StripePayoutData,
} from "./types";

/**
 * The fake Stripe (STRIPE_DRIVER=fake; ADR 0020): development, CI and end-to-end tests only, refused on Vercel. It
 * keeps accounts and payouts in this server process's memory (one `next start` in end-to-end tests), behaves like the
 * parts of Stripe Daybell uses, and sends its "hosted onboarding" to /dev/stripe-onboarding. Ids look like Stripe's.
 * Like the real driver since the Accounts v2 move (ADR 0020 amendment), creating an account returns its id only; read
 * back, it needs its details and has Stripe's own schedule (daily) until Daybell sets one, which marks the schedule as
 * set in its metadata (SCHEDULE_SET_KEY; security review 1).
 */
/** A hosted checkout in the fake (ADR 0023): its parameters as Daybell sent them, and once paid, what Stripe made. */
interface FakeCheckout {
  id: string;
  params: CheckoutSessionParams;
  status: "open" | "complete" | "expired";
  expiresAt: number;
  paid: {
    tax: number;
    total: number;
    fee: number;
    paymentIntentId: string;
    chargeId: string;
    transferId: string;
    balanceTransactionId: string;
    /** Development memory only: handed back once for the receipt, like Stripe's own. */
    email: string;
    shipping: CheckoutSessionFacts["shipping"];
  } | null;
}

interface FakeState {
  accounts: Map<string, StripeAccountData>;
  idempotency: Map<string, string>;
  payouts: Map<string, StripePayoutData & { account: string }>;
  returnUrls: Map<string, string>;
  checkouts: Map<string, FakeCheckout>;
  /** Reversals of transfers (the card fee, call 1), by order. */
  reversals: Map<string, { id: string; transferId: string; amount: number }>;
  /** Receipts Stripe would send (counts by payment, never the email). */
  receipts: Map<string, number>;
  /** Card prefixes set (call 7). */
  prefixes: Map<string, string>;
  taxHeadOffices: Set<string>;
  taxRegistrations: Map<
    string,
    { account: string; kind: string; province: string | null; active: boolean }
  >;
}

const STATE = Symbol.for("daybell.fakeStripe");

function state(): FakeState {
  const g = globalThis as { [STATE]?: FakeState };
  g[STATE] ??= {
    accounts: new Map(),
    idempotency: new Map(),
    payouts: new Map(),
    returnUrls: new Map(),
    checkouts: new Map(),
    reversals: new Map(),
    receipts: new Map(),
    prefixes: new Map(),
    taxHeadOffices: new Set(),
    taxRegistrations: new Map(),
  };
  return g[STATE];
}

const ALPHANUMERIC = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export function fakeId(
  prefix: "acct" | "po" | "evt" | "cs_test" | "pi" | "ch" | "tr" | "trr" | "txn" | "taxreg",
): string {
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

function checkout(id: string): FakeCheckout {
  const found = state().checkouts.get(id);
  if (!found) throw new Error("fake_stripe_no_checkout");
  // Like Stripe, an open checkout past its time is expired.
  if (found.status === "open" && found.expiresAt * 1000 <= Date.now()) found.status = "expired";
  return found;
}

/** What a checkout charges before tax: its lines and its one shipping option, in whole cents. */
function checkoutAmounts(params: CheckoutSessionParams): { subtotal: number; shipping: number } {
  const subtotal = (params.line_items ?? []).reduce(
    (sum, l) => sum + (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1),
    0,
  );
  const shipping = params.shipping_options?.[0]?.shipping_rate_data?.fixed_amount?.amount ?? 0;
  return { subtotal, shipping };
}

/** The fake's tax: 13% (Ontario's HST) when the studio collects tax, else none; whole cents, half up. */
export const fakeTax = (taxable: number, enabled: boolean) =>
  enabled ? Math.floor((taxable * 13 + 50) / 100) : 0;
/** The fake's card fee: 2.9% + 30¢ of what was charged, half up (PAYOUT_FEES' placeholder). */
export const fakeCardFee = (total: number) => Math.floor((total * 29 + 500) / 1000) + 30;

const metadata = (c: FakeCheckout, key: string): string | null => {
  const value = c.params.metadata?.[key];
  return typeof value === "string" ? value : null;
};

function facts(c: FakeCheckout): CheckoutSessionFacts {
  const { subtotal, shipping } = checkoutAmounts(c.params);
  const intent = c.params.payment_intent_data;
  const paid = c.paid;
  return {
    id: c.id,
    status: c.status,
    paymentStatus: paid ? "paid" : "unpaid",
    livemode: false,
    url: c.status === "open" ? `${siteUrl()}/dev/stripe-checkout?session=${c.id}` : null,
    expiresAt: c.expiresAt,
    currency: c.params.line_items?.[0]?.price_data?.currency ?? null,
    amountSubtotal: subtotal,
    amountShipping: shipping,
    amountTax: paid ? paid.tax : null,
    amountTotal: paid ? paid.total : subtotal + shipping,
    orderId: metadata(c, "daybell_order_id"),
    studioId: metadata(c, "daybell_studio_id"),
    region: metadata(c, "daybell_region"),
    paymentIntentId: paid?.paymentIntentId ?? null,
    chargeId: paid?.chargeId ?? null,
    transferId: paid?.transferId ?? null,
    destination: paid ? (intent?.transfer_data?.destination ?? null) : null,
    applicationFeeAmount: paid ? (intent?.application_fee_amount ?? null) : null,
    balanceTransaction: paid
      ? {
          id: paid.balanceTransactionId,
          feeCents: paid.fee,
          currency: c.params.line_items?.[0]?.price_data?.currency ?? "cad",
        }
      : null,
    receiptEmail: paid?.email ?? null,
    shipping: paid?.shipping ?? null,
  };
}

export function fakeDriver(): PaymentsProvider {
  return {
    driver: "fake",
    livemode: false,
    // contactEmail is accepted and ignored: the fake never keeps anything personal.
    async createAccount({ studioId, region, idempotencyKey }) {
      const s = state();
      const known = s.idempotency.get(idempotencyKey);
      if (known) return { id: known };
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
        settings: { payouts: { schedule: { interval: "daily", delay_days: 2 } } },
        metadata: { daybell_studio_id: studioId, daybell_region: region },
      });
      s.idempotency.set(idempotencyKey, id);
      return { id };
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
      a.metadata = { ...a.metadata, [SCHEDULE_SET_KEY]: "true" };
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

    // ── Checkout (ADR 0023): "Stripe's" hosted page is /dev/stripe-checkout ────────────────────────────────────────
    async createCheckoutSession(params, idempotencyKey) {
      const s = state();
      const known = s.idempotency.get(idempotencyKey);
      const existing = known ? s.checkouts.get(known) : undefined;
      if (existing)
        return {
          id: existing.id,
          url: `${siteUrl()}/dev/stripe-checkout?session=${existing.id}`,
          expiresAt: existing.expiresAt,
        };
      const id = fakeId("cs_test");
      const expiresAt = params.expires_at ?? Math.floor(Date.now() / 1000) + 24 * 60 * 60;
      s.checkouts.set(id, { id, params, status: "open", expiresAt, paid: null });
      s.idempotency.set(idempotencyKey, id);
      return { id, url: `${siteUrl()}/dev/stripe-checkout?session=${id}`, expiresAt };
    },
    async retrieveCheckoutSession(sessionId) {
      return facts(checkout(sessionId));
    },
    async expireCheckoutSession(sessionId) {
      const c = checkout(sessionId);
      if (c.status === "open") c.status = "expired";
      return { status: c.status };
    },
    async setReceiptEmail(paymentIntentId) {
      const receipts = state().receipts;
      receipts.set(paymentIntentId, (receipts.get(paymentIntentId) ?? 0) + 1);
    },
    async recoverCardFee({ transferId, amountCents, orderId }) {
      const reversals = state().reversals;
      const earlier = reversals.get(orderId);
      if (earlier) return { reversalId: earlier.id };
      const id = fakeId("trr");
      reversals.set(orderId, { id, transferId, amount: amountCents });
      return { reversalId: id };
    },
    async setCardPrefix(accountId) {
      account(accountId);
      state().prefixes.set(accountId, "DBL");
    },

    // ── Taxes ──────────────────────────────────────────────────────────────────────────────────────────────────────
    // The address is accepted and never kept: the fake only remembers that the account has one.
    async setTaxHeadOffice(accountId) {
      account(accountId);
      state().taxHeadOffices.add(accountId);
    },
    async createTaxRegistration(accountId, registration, idempotencyKey) {
      account(accountId);
      const s = state();
      const known = s.idempotency.get(idempotencyKey);
      if (known) return { id: known };
      if (!s.taxHeadOffices.has(accountId)) throw new Error("fake_stripe_no_head_office");
      const id = fakeId("taxreg");
      s.taxRegistrations.set(id, {
        account: accountId,
        kind: registration.kind,
        province: registration.kind === "pst" ? registration.province : null,
        active: true,
      });
      s.idempotency.set(idempotencyKey, id);
      return { id };
    },
    async expireTaxRegistration(accountId, registrationId) {
      const found = state().taxRegistrations.get(registrationId);
      if (!found || found.account !== accountId) throw new Error("fake_stripe_no_registration");
      found.active = false;
    },
  };
}

/** What the fake checkout page shows: the order's lines and amounts as Daybell sent them, and where to go after. */
export function fakeCheckoutSummary(sessionId: string): {
  status: FakeCheckout["status"];
  studioName: string;
  currency: string;
  lines: { name: string; quantity: number; amount: number }[];
  shipping: { name: string; amount: number } | null;
  collectsAddress: boolean;
  taxEnabled: boolean;
  subtotal: number;
  processedBy: string | null;
} | null {
  const c = state().checkouts.get(sessionId);
  if (!c) return null;
  const { subtotal, shipping } = checkoutAmounts(c.params);
  const option = c.params.shipping_options?.[0]?.shipping_rate_data;
  const submit = c.params.custom_text?.submit;
  return {
    status: checkout(sessionId).status,
    studioName: c.params.branding_settings?.display_name ?? "",
    currency: c.params.line_items?.[0]?.price_data?.currency ?? "cad",
    lines: (c.params.line_items ?? []).map((l) => ({
      name: l.price_data?.product_data?.name ?? "",
      quantity: l.quantity ?? 1,
      amount: (l.price_data?.unit_amount ?? 0) * (l.quantity ?? 1),
    })),
    shipping: option ? { name: option.display_name, amount: shipping } : null,
    collectsAddress: Boolean(c.params.shipping_address_collection),
    taxEnabled: Boolean(c.params.automatic_tax?.enabled),
    subtotal,
    processedBy: submit && typeof submit === "object" ? submit.message : null,
  };
}

/**
 * "Stripe" takes the payment: tax (13% with Stripe Tax on), Stripe's fee (2.9% + 30¢), a payment, charge and transfer to
 * the destination, then answers where to send the parent. Refuses a checkout that isn't open, and a home delivery
 * without an address.
 */
export function fakePayCheckout(
  sessionId: string,
  input: { email: string; shipping: CheckoutSessionFacts["shipping"] },
): string {
  const c = checkout(sessionId);
  if (c.status !== "open") throw new Error("fake_stripe_checkout_not_open");
  if (c.params.shipping_address_collection && !input.shipping)
    throw new Error("fake_stripe_address_needed");
  const { subtotal, shipping } = checkoutAmounts(c.params);
  const tax = fakeTax(subtotal + shipping, Boolean(c.params.automatic_tax?.enabled));
  const total = subtotal + shipping + tax;
  c.status = "complete";
  c.paid = {
    tax,
    total,
    fee: fakeCardFee(total),
    paymentIntentId: fakeId("pi"),
    chargeId: fakeId("ch"),
    transferId: fakeId("tr"),
    balanceTransactionId: fakeId("txn"),
    email: input.email,
    shipping: c.params.shipping_address_collection ? input.shipping : null,
  };
  return c.params.success_url ?? siteUrl();
}

/** The parent leaves "Stripe" without paying: where Daybell asked them to be sent back to. */
export function fakeCancelCheckout(sessionId: string): string {
  return checkout(sessionId).params.cancel_url ?? siteUrl();
}

/** Receipts "Stripe" sent for a payment (tests): a count, never the address. */
export function fakeReceipts(paymentIntentId: string): number {
  return state().receipts.get(paymentIntentId) ?? 0;
}

/** The card fee recovered for an order (tests). */
export function fakeReversal(
  orderId: string,
): { id: string; transferId: string; amount: number } | null {
  return state().reversals.get(orderId) ?? null;
}

/** The checkout's parameters as Daybell sent them (tests). */
export function fakeCheckoutParams(sessionId: string): CheckoutSessionParams | null {
  return state().checkouts.get(sessionId)?.params ?? null;
}

/** The card prefix set on an account (tests). */
export function fakeCardPrefix(accountId: string): string | null {
  return state().prefixes.get(accountId) ?? null;
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
