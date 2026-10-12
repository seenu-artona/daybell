import "server-only";
import { ApiError } from "@daybell/api";
import { regionDatabase } from "@daybell/config";
import { NextResponse } from "next/server";
import { accountForDatabase, payoutForDatabase, regionOfAccount } from "./payouts";
import { assertFunctionRegion } from "./region-guard";
import { payments, verifyStripeEvent, webhookSecrets } from "./stripe";
import { payoutSystemRpc } from "./supabase/service";
import { readCapped } from "./worker-auth";

/**
 * Stripe's webhook (ADR 0020; D96 "Stripe events queued with duplicate protection"). In order:
 * 1. read the raw body (at most 512 KB) and check Stripe-Signature against STRIPE_WEBHOOK_SECRET (one or two);
 * 2. refuse an event whose mode (live or test) isn't the key's;
 * 3. answer 200 and store nothing for events Daybell doesn't handle or that aren't from a connected account;
 * 4. read the account from Stripe again and route by the region in its metadata (Claude's call Q11);
 * 5. record the event in that region's inbox (once; 404 for an account Daybell doesn't know yet, so Stripe tries
 *    again; 409 while another delivery is processing it; 200 if it was already processed);
 * 6. copy the account or the payout as Stripe has it now, and mark the event done; on failure record the error's
 *    code and answer 500, so Stripe tries again.
 * The payload is never stored or logged: only fixed names and the event type.
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

const ACCOUNT_ID = /^acct_[A-Za-z0-9]{1,250}$/;
const PAYOUT_ID = /^po_[A-Za-z0-9]{1,250}$/;
const EVENT_ID = /^evt_[A-Za-z0-9]{1,250}$/;

const refused = (log: string) => {
  console.error(log);
  return new ApiError("invalid_input", "This isn't a valid Stripe event.");
};

const received = () =>
  NextResponse.json({ received: true }, { headers: { "cache-control": "private, no-store" } });

type Claim = { inbox_id: number; studio_id: string; processed: boolean; claimed: boolean } | null;

export async function handleStripeWebhook(request: Request): Promise<Response> {
  if (Number(request.headers.get("content-length") ?? "0") > STRIPE_WEBHOOK_MAX_BYTES)
    throw refused("stripe_webhook_too_big");
  const body = await readCapped(request, STRIPE_WEBHOOK_MAX_BYTES, () =>
    refused("stripe_webhook_too_big"),
  );
  const event = verifyStripeEvent(body, request.headers.get("stripe-signature"), webhookSecrets());
  if (!event) throw refused("stripe_webhook_bad_signature");
  const provider = payments();
  if (event.livemode !== provider.livemode) throw refused("stripe_webhook_wrong_mode");
  if (!HANDLED_EVENTS.has(event.type) || !event.account) {
    console.warn("stripe_webhook_ignored", event.type);
    return received();
  }
  if (!ACCOUNT_ID.test(event.account) || !EVENT_ID.test(event.id))
    throw refused("stripe_webhook_bad_ids");
  const accountId = event.account;
  const payoutId = event.type.startsWith("payout.")
    ? (event.data.object as { id?: unknown }).id
    : null;
  if (payoutId !== null && (typeof payoutId !== "string" || !PAYOUT_ID.test(payoutId)))
    throw refused("stripe_webhook_bad_ids");

  // Stripe is asked again rather than trusting the payload: nothing personal is kept, and the order events arrive in
  // doesn't matter.
  const account = await provider.retrieveAccount(accountId);
  const region = regionOfAccount(account);
  if (!regionDatabase(region)) throw new ApiError("not_found", "Unknown account.");
  assertFunctionRegion(region);

  const recorded = await payoutSystemRpc(region, "record_stripe_event", {
    p_event_id: event.id,
    p_type: event.type,
    p_stripe_account_id: accountId,
    p_livemode: event.livemode,
    p_created: new Date(event.created * 1000).toISOString(),
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
  if (!claim.claimed) throw new ApiError("conflict", "This event is being processed.");

  let error: string | null = null;
  try {
    if (payoutId) {
      const payout = await provider.retrievePayout(accountId, payoutId);
      const synced = await payoutSystemRpc(region, "sync_payout", {
        p_stripe_account_id: accountId,
        p_payout: payoutForDatabase(payout),
      });
      if (synced.error) error = "sync_failed";
    } else {
      const { status, facts, schedule } = accountForDatabase(account);
      const synced = await payoutSystemRpc(region, "sync_payout_account", {
        p_stripe_account_id: accountId,
        p_facts: facts,
        p_schedule: schedule,
        p_status: status,
      });
      if (synced.error) error = "sync_failed";
    }
  } catch (err) {
    error = err instanceof ApiError ? "stripe_unavailable" : "unexpected_object";
  }
  const finished = await payoutSystemRpc(region, "finish_stripe_event", {
    p_inbox_id: claim.inbox_id,
    p_error_code: error,
  });
  if (error || finished.error) {
    console.error("stripe_webhook_failed", event.type, error ?? "finish_failed");
    throw new ApiError("internal", "Something went wrong on our side.");
  }
  return received();
}
