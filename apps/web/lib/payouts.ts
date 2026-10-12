import "server-only";
import {
  ApiError,
  fromDatabaseError,
  PAYOUT_CONFLICTS,
  type Payout,
  type PayoutAccount,
  type StudioPayoutsResponse,
  type StudioSummary,
} from "@daybell/api";
import { type DataRegion, isDataRegion, PAYOUT_FEES, siteUrl } from "@daybell/config";
import {
  canManagePayouts,
  currencyForRegion,
  nextPayoutDay,
  PAYOUT_INTERVALS,
  PAYOUT_METHODS,
  PAYOUT_STATUSES,
  PAYOUT_WEEKDAYS,
  type PayoutAccountFacts,
  type PayoutAccountStatus,
  type PayoutInterval,
  type PayoutMethod,
  type PayoutSchedule,
  type PayoutStatus,
  type PayoutWeekday,
  payoutAccountStatus,
} from "@daybell/core";
import type { SupabaseClient } from "@supabase/supabase-js";
import { check } from "./api";
import { PAYOUT_REGIONS } from "./region-guard";
import type { StripeAccountData, StripePayoutData } from "./stripe";

/**
 * Payouts (Phase 1 step 7; ADR 0020): Stripe's objects turned into the few facts Daybell keeps (ids, flags, counts,
 * Stripe's codes, the schedule, amounts and dates; never names, banks or addresses), the database's named errors as
 * API errors, and the studio's payouts in the API's shape. Every query is filtered by the caller's studio as well as by
 * row-level security (D96).
 */

type DbError = { code?: string; message?: string } | null;

const CODE = /^[a-z_.]{1,100}$/;
const count = (list: readonly unknown[] | null | undefined) => Math.min(list?.length ?? 0, 1000);
const isOneOf = <T extends string>(list: readonly T[], value: unknown): value is T =>
  typeof value === "string" && (list as readonly string[]).includes(value);

/** The flags and counts of a Stripe account; an unexpected reason code is kept as "other", never as free text. */
export function accountFacts(
  account: StripeAccountData,
): PayoutAccountFacts & { deadline: string | null } {
  const r = account.requirements;
  const reason = r?.disabled_reason ?? null;
  return {
    detailsSubmitted: account.details_submitted,
    chargesEnabled: account.charges_enabled,
    payoutsEnabled: account.payouts_enabled,
    disabledReason: reason === null ? null : CODE.test(reason) ? reason : "other",
    currentlyDue: count(r?.currently_due),
    pastDue: count(r?.past_due),
    pendingVerification: count(r?.pending_verification),
    deadline: r?.current_deadline ? new Date(r.current_deadline * 1000).toISOString() : null,
  };
}

/** The schedule as Stripe has it. Several weekly days or monthly dates are kept as the first one. */
export function accountSchedule(
  account: StripeAccountData,
): PayoutSchedule & { delayDays: number } {
  const s = account.settings?.payouts?.schedule;
  if (!s || !isOneOf(PAYOUT_INTERVALS, s.interval)) throw new Error("payout_schedule_unknown");
  const interval: PayoutInterval = s.interval;
  const weekday = s.weekly_anchor ?? s.weekly_payout_days?.[0] ?? null;
  const monthDay = s.monthly_anchor ?? s.monthly_payout_days?.[0] ?? null;
  return {
    interval,
    weeklyAnchor:
      interval === "weekly" && isOneOf(PAYOUT_WEEKDAYS, weekday)
        ? (weekday as PayoutWeekday)
        : null,
    monthlyAnchor: interval === "monthly" ? monthDay : null,
    delayDays: Math.max(0, Math.min(365, Math.trunc(s.delay_days ?? 0))),
  };
}

/** The status, facts and schedule as the database functions take them. */
export function accountForDatabase(account: StripeAccountData): {
  status: PayoutAccountStatus;
  facts: Record<string, unknown>;
  schedule: Record<string, unknown>;
} {
  const f = accountFacts(account);
  const s = accountSchedule(account);
  return {
    status: payoutAccountStatus(f),
    facts: {
      details_submitted: f.detailsSubmitted,
      charges_enabled: f.chargesEnabled,
      payouts_enabled: f.payoutsEnabled,
      disabled_reason: f.disabledReason,
      currently_due_count: f.currentlyDue,
      past_due_count: f.pastDue,
      pending_verification_count: f.pendingVerification,
      requirements_deadline: f.deadline,
    },
    schedule: {
      payout_interval: s.interval,
      weekly_anchor: s.weeklyAnchor,
      monthly_anchor: s.monthlyAnchor,
      delay_days: s.delayDays,
    },
  };
}

const isoDay = (seconds: number) => new Date(seconds * 1000).toISOString().slice(0, 10);

/** A payout as the database function takes it: amount, currency, status, dates and Stripe's failure code only. */
export function payoutForDatabase(payout: StripePayoutData): Record<string, unknown> {
  if (!isOneOf(PAYOUT_STATUSES, payout.status) || !isOneOf(PAYOUT_METHODS, payout.method))
    throw new Error("payout_unknown");
  if (!Number.isSafeInteger(payout.amount)) throw new Error("payout_unknown");
  const failure = payout.failure_code;
  return {
    stripe_payout_id: payout.id,
    amount_cents: payout.amount,
    currency: payout.currency.toUpperCase(),
    status: payout.status,
    method: payout.method,
    automatic: payout.automatic,
    arrival_date: isoDay(payout.arrival_date),
    failure_code: failure === null ? null : /^[a-z_]{1,100}$/.test(failure) ? failure : "other",
    stripe_created_at: new Date(payout.created * 1000).toISOString(),
  };
}

/**
 * Which regional database an account's studio lives in (Claude's call Q11): the region Daybell wrote in the account's
 * metadata when it created it, else Canada (the only payout region in Phase 1).
 */
export function regionOfAccount(account: StripeAccountData): DataRegion {
  const region = account.metadata?.daybell_region;
  return isDataRegion(region) && PAYOUT_REGIONS.includes(region) ? region : "ca";
}

/** The ISO country of a region's studios' Stripe accounts. */
export function countryForRegion(region: DataRegion): "CA" | "US" {
  return region === "ca" ? "CA" : "US";
}

/** Where Stripe sends the owner back to: always this deployment's own address, never one from the request. */
export const payoutsReturnUrl = (kind: "return" | "refresh") =>
  `${siteUrl()}/app/settings/payouts?stripe=${kind}`;

const conflict = (message: string, form: string) => new ApiError("conflict", message, { form });

export const NOT_CONNECTED = () =>
  conflict("Payouts aren't set up yet.", PAYOUT_CONFLICTS.notConnected);

/** The named refusals of the payout functions (their messages carry no values), as API errors. */
export function payoutError(error: NonNullable<DbError>): ApiError {
  if (error.code === "P0001" && error.message === "already_connected")
    return conflict(
      "This studio is already connected to Stripe.",
      PAYOUT_CONFLICTS.alreadyConnected,
    );
  if (error.code === "P0001" && error.message === "not_connected") return NOT_CONNECTED();
  return fromDatabaseError(error);
}

export function payoutResult<T>(result: { data: unknown; error: DbError }): T {
  if (result.error) throw payoutError(result.error);
  return result.data as T;
}

export interface PayoutAccountRow {
  id: string;
  stripe_account_id: string;
  status: PayoutAccountStatus;
  details_submitted: boolean;
  charges_enabled: boolean;
  payouts_enabled: boolean;
  disabled_reason: string | null;
  currently_due_count: number;
  past_due_count: number;
  requirements_deadline: string | null;
  payout_interval: PayoutInterval;
  weekly_anchor: PayoutWeekday | null;
  monthly_anchor: number | null;
}

const ACCOUNT_COLUMNS =
  "id, stripe_account_id, status, details_submitted, charges_enabled, payouts_enabled, disabled_reason, currently_due_count, past_due_count, requirements_deadline, payout_interval, weekly_anchor, monthly_anchor";

/** The studio's payout account, through row-level security (owners and admins), or null before setup has started. */
export async function loadPayoutAccountRow(
  supabase: SupabaseClient,
  studioId: string,
): Promise<PayoutAccountRow | null> {
  return check(
    await supabase
      .from("payout_accounts")
      .select(ACCOUNT_COLUMNS)
      .eq("studio_id", studioId)
      .maybeSingle(),
  ) as PayoutAccountRow | null;
}

interface PayoutRow {
  id: string;
  amount_cents: number | string;
  currency: "USD" | "CAD";
  status: PayoutStatus;
  method: PayoutMethod;
  automatic: boolean;
  arrival_date: string;
  failure_code: string | null;
}

export function toPayoutAccount(row: PayoutAccountRow): PayoutAccount {
  return {
    status: row.status,
    chargesEnabled: row.charges_enabled,
    payoutsEnabled: row.payouts_enabled,
    detailsSubmitted: row.details_submitted,
    currentlyDue: row.currently_due_count,
    pastDue: row.past_due_count,
    deadline: row.requirements_deadline ? new Date(row.requirements_deadline).toISOString() : null,
    disabledReason: row.disabled_reason,
    schedule: {
      interval: row.payout_interval,
      weeklyAnchor: row.weekly_anchor,
      monthlyAnchor: row.monthly_anchor,
    },
  };
}

export function toPayout(row: PayoutRow): Payout {
  return {
    id: row.id,
    amount: { cents: Number(row.amount_cents), currency: row.currency },
    status: row.status,
    method: row.method,
    automatic: row.automatic,
    arrivalDate: row.arrival_date,
    failureCode: row.failure_code,
  };
}

/** The fees Settings › Payouts explains, in the studio's currency (D98, D59; Claude's call Q8). */
export function feesFor(region: DataRegion): StudioPayoutsResponse["fees"] {
  const currency = currencyForRegion(region);
  const table = PAYOUT_FEES[currency];
  const money = (cents: number) => ({ cents, currency });
  return {
    daybellBasisPoints: table.daybellBasisPoints,
    card: { basisPoints: table.card.basisPoints, fixed: money(table.card.fixedCents) },
    payout: { basisPoints: table.payout.basisPoints, fixed: money(table.payout.fixedCents) },
    activeAccount: money(table.activeAccountCents),
    instantBasisPoints: table.instantBasisPoints,
  };
}

const utcToday = () => new Date().toISOString().slice(0, 10);

/** Everything Settings › Payouts shows, from Daybell's copy (never a live Stripe call; Claude's call Q9). */
export async function loadStudioPayouts(
  supabase: SupabaseClient,
  studio: StudioSummary,
  today: string = utcToday(),
): Promise<StudioPayoutsResponse> {
  const row = await loadPayoutAccountRow(supabase, studio.id);
  const payouts = row
    ? ((check(
        await supabase
          .from("payouts")
          .select(
            "id, amount_cents, currency, status, method, automatic, arrival_date, failure_code",
          )
          .eq("studio_id", studio.id)
          .order("arrival_date", { ascending: false })
          .order("stripe_created_at", { ascending: false })
          .limit(10),
      ) ?? []) as PayoutRow[])
    : [];
  const account = row ? toPayoutAccount(row) : null;
  return {
    account,
    nextPayoutDate:
      account?.payoutsEnabled === true ? nextPayoutDay(account.schedule, today) : null,
    payouts: payouts.map(toPayout),
    fees: feesFor(studio.region),
    canManage: canManagePayouts(studio.role),
  };
}
