import "server-only";
import { ApiError } from "@daybell/api";
import { regionDatabase } from "@daybell/config";
import { NextResponse } from "next/server";
import {
  payoutForDatabase,
  regionOfAccount,
  syncAccountCopy,
  withDefaultSchedule,
} from "./payouts";
import { assertFunctionRegion, assertPayoutFunctionRegion } from "./region-guard";
import { payments, type VerifiedStripeEvent, verifyStripeWebhook, webhookSecrets } from "./stripe";
import { payoutSystemRpc } from "./supabase/service";
import { readCapped } from "./worker-auth";

/**
 * Stripe's webhook (ADR 0020; D96 "Stripe events queued with duplicate protection"). It takes two payload styles on
 * one address: v1 snapshot events (account.updated, payout.*) and, since studio accounts are created with Accounts v2,
 * v2 thin events about the account (v2.core.account[requirements].updated and the like; ADR 0020 amendment). Both are
 * handled the same way, in order:
 * 1. read the raw body (at most 512 KB) and check Stripe-Signature against STRIPE_WEBHOOK_SECRET (one secret per
 *    event destination, plus one during a rotation);
 * 2. refuse an event whose mode (live or test) isn't the key's;
 * 3. answer 200 and store nothing for events Daybell doesn't handle or that aren't about a connected account;
 * 4. refuse to go on outside the payout regions' function regions, before anything is asked of Stripe (D113);
 * 5. read the account from Stripe again and route by the region in its metadata (Claude's call Q11);
 * 6. record the event in that region's inbox (once; 404 for an account Daybell doesn't know yet, so Stripe tries
 *    again; 409 while another delivery is processing it; 200 if it was already processed), taking its lease;
 * 7. check that the studio Daybell wrote in the account's metadata is the one the database maps it to (a backstop:
 *    the database's mapping is what's used);
 * 8. copy the account or the payout as Stripe had it when asked, first setting Daybell's default payout schedule on an
 *    account whose schedule Daybell hasn't set yet (security review 1) (an older answer never overwrites a newer copy), and
 *    mark the event done with the lease. A failure that a retry can fix (Stripe or the database unreachable) is
 *    recorded by its code and answered with 500, so Stripe tries again; one that can never succeed (a payout in the
 *    wrong currency, an object Daybell can't read, a studio mismatch) is recorded as processed with its code, logged
 *    for an alert, and answered with 200.
 * The payload is never stored or logged: only fixed names, the event type and error codes. A thin event carries ids
 * only, and Daybell never calls its fetchRelatedObject: the account is read through the same v1 call as for snapshot
 * events, so the facts mapping is the same.
 */

export const STRIPE_WEBHOOK_MAX_BYTES = 512 * 1024;

export const HANDLED_EVENTS = new Set([
  "account.updated",
  "capability.updated",
  "payout.created",
  "payout.updated",
  "payout.paid",
  "payout.failed",
  "payout.canceled",
]);

/**
 * Accounts v2 thin events that can change what Daybell keeps (requirements, capabilities, the account itself). Each
 * leads to the account being read again. They need their own event destination with the thin payload style
 * (docs/stripe-staging.md).
 */
export const HANDLED_THIN_EVENTS = new Set([
  "v2.core.account.updated",
  "v2.core.account[requirements].updated",
  "v2.core.account[configuration.merchant].updated",
  "v2.core.account[configuration.merchant].capability_status_updated",
  "v2.core.account[configuration.recipient].updated",
  "v2.core.account[configuration.recipient].capability_status_updated",
]);

const ACCOUNT_ID = /^acct_[A-Za-z0-9]{1,250}$/;
const PAYOUT_ID = /^po_[A-Za-z0-9]{1,250}$/;
const EVENT_ID = /^evt_[A-Za-z0-9]{1,250}$/;
/** v2 event ids can hold underscores (e.g. evt_test_…). */
const THIN_EVENT_ID = /^evt_[A-Za-z0-9_]{1,250}$/;
const MAX_EVENT_AGE_MS = 365 * 24 * 60 * 60 * 1000;

/** What Daybell needs from either payload style: ids, the type, the mode and the time. */
interface NormalizedStripeEvent {
  id: string;
  type: string;
  livemode: unknown;
  handled: boolean;
  /** The connected account the event is about (checked below), else null. */
  accountId: unknown;
  /** The payout's id for payout events (checked below), else null. */
  payoutId: unknown;
  createdMs: number;
  eventIdPattern: RegExp;
  /** False when a thin event's context names another account than its related object (security review 5). */
  contextMatches: boolean;
}

function normalizeStripeEvent(verified: VerifiedStripeEvent): NormalizedStripeEvent {
  if (verified.payload === "snapshot") {
    const event = verified.event;
    return {
      id: event.id,
      type: event.type,
      livemode: event.livemode,
      handled: HANDLED_EVENTS.has(event.type),
      accountId: event.account,
      payoutId:
        typeof event.type === "string" && event.type.startsWith("payout.")
          ? (event.data?.object as { id?: unknown } | undefined)?.id
          : null,
      createdMs: event.created * 1000,
      eventIdPattern: EVENT_ID,
      contextMatches: true,
    };
  }
  const event = verified.event;
  const related = event.related_object;
  const accountId = related?.type === "v2.core.account" ? related.id : null;
  return {
    id: event.id,
    type: event.type,
    livemode: event.livemode,
    handled: HANDLED_THIN_EVENTS.has(event.type),
    // The account the event is about. Its id is the same for v1 and v2 endpoints.
    accountId,
    payoutId: null,
    createdMs: typeof event.created === "string" ? Date.parse(event.created) : Number.NaN,
    eventIdPattern: THIN_EVENT_ID,
    // An event about a connected account carries it as its context too; the two must agree.
    contextMatches:
      typeof event.context !== "string" ||
      !event.context.startsWith("acct_") ||
      event.context === accountId,
  };
}

const refused = (log: string) => {
  console.error(log);
  return new ApiError("invalid_input", "This isn't a valid Stripe event.");
};

const received = () =>
  NextResponse.json({ received: true }, { headers: { "cache-control": "private, no-store" } });

type Claim = {
  inbox_id: number;
  studio_id: string;
  processed: boolean;
  claimed: boolean;
  lease: string | null;
} | null;

/** The database's named refusals that no retry can fix (the object itself is wrong for Daybell). */
const PERMANENT_DB_ERRORS = new Set([
  "payout_currency",
  "payout_mismatch",
  "payout_fixed",
  "payout_account_fixed",
  "payout_country",
]);

type Failure = { code: string; permanent: boolean } | null;

function syncFailure(error: { code?: string; message?: string } | null): Failure {
  if (!error) return null;
  return error.message && PERMANENT_DB_ERRORS.has(error.message)
    ? { code: error.message, permanent: true }
    : { code: "sync_failed", permanent: false };
}

export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > STRIPE_WEBHOOK_MAX_BYTES)
    throw refused("stripe_webhook_too_big");
  const body = await readCapped(request, STRIPE_WEBHOOK_MAX_BYTES, () =>
    refused("stripe_webhook_too_big"),
  );
  const verified = verifyStripeWebhook(
    body,
    request.headers.get("stripe-signature"),
    webhookSecrets(),
  );
  if (!verified) throw refused("stripe_webhook_bad_signature");
  const event = normalizeStripeEvent(verified);
  const provider = payments();
  if (event.livemode !== provider.livemode) throw refused("stripe_webhook_wrong_mode");
  if (!event.handled || !event.accountId) {
    console.warn("stripe_webhook_ignored", typeof event.type === "string" ? event.type : "unknown");
    return received();
  }
  if (
    typeof event.accountId !== "string" ||
    !ACCOUNT_ID.test(event.accountId) ||
    typeof event.id !== "string" ||
    !event.eventIdPattern.test(event.id) ||
    !event.contextMatches
  )
    throw refused("stripe_webhook_bad_ids");
  // A finite time within a year of now (security review 7): Stripe retries for days, never a year, and a time out of
  // Date's range would otherwise fail later as a generic 500.
  if (
    !Number.isFinite(event.createdMs) ||
    Math.abs(event.createdMs - Date.now()) > MAX_EVENT_AGE_MS
  )
    throw refused("stripe_webhook_bad_time");
  const accountId = event.accountId;
  const payoutId = event.payoutId;
  if (payoutId !== null && (typeof payoutId !== "string" || !PAYOUT_ID.test(payoutId)))
    throw refused("stripe_webhook_bad_ids");

  // D113 (security review M1): a Canadian studio's account is never fetched into a function outside Montréal. The
  // studio's region isn't known until the account is read, so every payout region's function region is checked first.
  assertPayoutFunctionRegion();

  // Stripe is asked again rather than trusting the payload: nothing personal is kept, and the order events arrive in
  // doesn't matter. The time it was asked travels with the copy, so an older answer never overwrites a newer one.
  const fetchedAt = new Date().toISOString();
  const account = await provider.retrieveAccount(accountId);
  const region = regionOfAccount(account);
  if (!regionDatabase(region)) throw new ApiError("not_found", "Unknown account.");
  assertFunctionRegion(region);

  const recorded = await payoutSystemRpc(region, "record_stripe_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_stripe_account_id: accountId,
    p_livemode: provider.livemode,
    p_created: new Date(event.createdMs).toISOString(),
  });
  if (recorded.error) {
    console.error("stripe_webhook_inbox_failed", event.type);
    throw new ApiError("internal", "Something went wrong on our side.");
  }
  const claim = recorded.data as Claim;
  if (!claim) {
    console.warn("stripe_webhook_unknown_account", event.type);
    throw new ApiError("not_found", "Unknown account.");
  }
  if (claim.processed) return received();
  if (!claim.claimed || !claim.lease)
    throw new ApiError("conflict", "This event is being processed.");

  let failure: Failure = null;
  if (account.metadata?.daybell_studio_id !== claim.studio_id) {
    // Never expected: Daybell writes the metadata when it creates the account. Nothing is copied.
    console.error("stripe_webhook_studio_mismatch", event.type);
    failure = { code: "studio_mismatch", permanent: true };
  } else {
    try {
      if (payoutId) {
        const payoutFetchedAt = new Date().toISOString();
        const payout = await provider.retrievePayout(accountId, payoutId);
        const synced = await payoutSystemRpc(region, "sync_payout", {
          p_stripe_account_id: accountId,
          p_payout: payoutForDatabase(payout),
          p_fetched_at: payoutFetchedAt,
        });
        failure = syncFailure(synced.error);
      } else {
        // Daybell's default schedule if its first try (after the account was recorded) failed (security review 1).
        const scheduled = await withDefaultSchedule(provider, accountId, account);
        const synced = await syncAccountCopy(region, accountId, scheduled, fetchedAt);
        failure = syncFailure(synced.error);
      }
    } catch (err) {
      failure =
        err instanceof ApiError
          ? { code: "stripe_unavailable", permanent: false }
          : { code: "unexpected_object", permanent: true };
    }
  }
  const finished = await payoutSystemRpc(region, "finish_stripe_event", {
    p_inbox_id: claim.inbox_id,
    p_lease: claim.lease,
    p_error_code: failure?.code ?? null,
    p_permanent: failure?.permanent ?? false,
  });
  if (finished.error || (failure && !failure.permanent)) {
    console.error("stripe_webhook_failed", event.type, failure?.code ?? "finish_failed");
    throw new ApiError("internal", "Something went wrong on our side.");
  }
  if (finished.data !== true) {
    // Another delivery took the event over (this one's lease ran out); it finishes the event, or Stripe tries again.
    console.warn("stripe_webhook_lease_lost", event.type);
    throw new ApiError("conflict", "This event is being processed.");
  }
  if (failure) {
    // Can never succeed, so it isn't retried: a fixed name to alert on, with the event type and the code.
    console.error("stripe_webhook_permanent_failure", event.type, failure.code);
  }
  return received();
}
