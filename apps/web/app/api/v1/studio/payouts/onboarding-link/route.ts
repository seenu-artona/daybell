import { ApiError, PAYOUT_NO_CONTACT_EMAIL, type PayoutLinkResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  accountForDatabase,
  countryForRegion,
  loadPayoutAccountRow,
  payoutResult,
  payoutsReturnUrl,
  stripeFetchTime,
  syncAccountCopy,
  takeStripeCall,
  withDefaultSchedule,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { assertStripeLink, payments, type StripeAccountData, StripeCallError } from "@/lib/stripe";
import { assertCanManagePayouts, studioScope } from "@/lib/studio";
import { payoutWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/onboarding-link — the owner sets up (or carries on setting up) payouts on Stripe's own
 * pages (Seenu, answers 1 and 2). The first time, it creates the studio's Stripe account with Accounts v2 (country,
 * currency, responsibilities, configurations, Daybell's ids and the owner's sign-in email as contact_email; Q1; ADR
 * 0020 section 16, step 7c) with an idempotency key, so a retry never makes a second account, then reads it back and
 * records it. The email comes from the verified auth user, never the request; without one nothing is sent to Stripe
 * (409 payouts.noContactEmail). It is never logged. Only then is Daybell's default
 * payout schedule set, as its own step (security review 1): if that fails the account is still recorded, the owner
 * still gets their link, and refresh or the webhook sets the schedule later.
 *
 * Accounts v2 replays a successful create with the same key for 30 days and re-executes a failed one
 * (docs.stripe.com/api-v2-overview). So if the create's outcome is unknown (a timeout or a 5xx), or recording fails
 * after Stripe made the account, the owner's next try gets the same account; a fixed alert line with the studio id lets
 * support find it on Stripe (its metadata has the same id) if nobody tries again within those 30 days. Each call makes
 * a new single-use Account Link, which must be Stripe's own address. Counts against the studio's Stripe budget. The
 * link is never logged.
 */
export const POST = handle(async () => {
  const { supabase, studio, userId, email } = await studioScope();
  assertCanManagePayouts(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const provider = payments();
  await takeStripeCall(studio);
  let accountId = (await loadPayoutAccountRow(supabase, studio.id))?.stripe_account_id ?? null;
  if (!accountId) {
    // Stripe requires a contact email with the recipient configuration (step 7c): without one, Stripe isn't asked.
    if (!email)
      throw new ApiError(
        "conflict",
        "Stripe needs an email address for your payout account. Please contact Daybell support.",
        { form: PAYOUT_NO_CONTACT_EMAIL },
      );
    const fetchedAt = stripeFetchTime();
    let created: { id: string };
    try {
      created = await provider.createAccount({
        studioId: studio.id,
        region: studio.region,
        country: countryForRegion(studio.region),
        contactEmail: email,
        // "-v2b" (step 7c): the body now has contact_email. v2 re-executes failed requests, but a key whose earlier
        // request had different parameters may be refused as an idempotency_error, so the new body gets a new key.
        // The studio id only: never the email (ADR 0020 section 16).
        idempotencyKey: `daybell-payout-account-v2b-${studio.id}`,
      });
    } catch (err) {
      // Refused: Stripe made nothing. Otherwise an account may exist: the studio id only (never anything personal), so
      // support can match it to the account's daybell_studio_id metadata.
      if (!(err instanceof StripeCallError && err.outcome === "refused"))
        console.error("stripe_account_create_unknown", studio.id);
      throw err;
    }
    // Stripe has the account from here on: anything that stops Daybell recording it raises the alert (security review
    // N4), with the studio id only (never the Stripe id or anything personal).
    let account: StripeAccountData;
    try {
      account = await provider.retrieveAccount(created.id);
      const { status, facts, schedule } = accountForDatabase(account);
      payoutResult(
        await payoutWriteRpc(studio.region, "create_payout_account", userId, {
          p_studio_id: studio.id,
          p_stripe_account_id: created.id,
          p_livemode: provider.livemode,
          p_facts: facts,
          p_schedule: schedule,
          p_status: status,
          p_fetched_at: fetchedAt,
        }),
      );
    } catch (err) {
      console.error("stripe_account_unrecorded", studio.id);
      throw err;
    }
    accountId = created.id;
    // The default schedule, a separate step after recording (security review 1). A failure is logged and left for
    // refresh and the webhook to retry; the owner carries on to Stripe either way.
    const scheduledAt = stripeFetchTime();
    const scheduled = await withDefaultSchedule(provider, created.id, account);
    if (scheduled !== account) {
      // Daybell's copy catches up on the next refresh or webhook if this fails.
      let saved = false;
      try {
        saved = !(await syncAccountCopy(studio.region, created.id, scheduled, scheduledAt)).error;
      } catch {
        saved = false;
      }
      if (!saved) console.error("payout_sync_failed");
    }
  }
  const link = await provider.createAccountLink({
    accountId,
    refreshUrl: payoutsReturnUrl("refresh"),
    returnUrl: payoutsReturnUrl("return"),
  });
  const body: PayoutLinkResponse = {
    url: assertStripeLink(link.url, provider.driver),
    expiresAt: new Date(link.expiresAt * 1000).toISOString(),
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
