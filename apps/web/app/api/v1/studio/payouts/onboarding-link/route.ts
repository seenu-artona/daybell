import type { PayoutLinkResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  accountForDatabase,
  countryForRegion,
  loadPayoutAccountRow,
  payoutResult,
  payoutsReturnUrl,
  stripeFetchTime,
  takeStripeCall,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { assertStripeLink, payments } from "@/lib/stripe";
import { assertCanManagePayouts, studioScope } from "@/lib/studio";
import { payoutWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/onboarding-link — the owner sets up (or carries on setting up) payouts on Stripe's own
 * pages (Seenu, answers 1 and 2). The first time, it creates the studio's Stripe account with Accounts v2 (country,
 * currency, responsibilities, configurations and Daybell's ids only; Q1, Q4; ADR 0020 amendment) with an idempotency
 * key, so a retry never makes a second account, then records it. If recording fails after Stripe made the account, a fixed alert line with the studio id
 * lets support find it on Stripe (its metadata has the same id) before Stripe's idempotency window ends. Each call
 * makes a new single-use Account Link, which must be Stripe's own address. Counts against the studio's Stripe budget.
 * The link is never logged.
 */
export const POST = handle(async () => {
  const { supabase, studio, userId } = await studioScope();
  assertCanManagePayouts(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const provider = payments();
  await takeStripeCall(studio);
  let accountId = (await loadPayoutAccountRow(supabase, studio.id))?.stripe_account_id ?? null;
  if (!accountId) {
    const fetchedAt = stripeFetchTime();
    const account = await provider.createAccount({
      studioId: studio.id,
      region: studio.region,
      country: countryForRegion(studio.region),
      // "-v2": Stripe keeps a key's first answer for 24 hours, and the v1 key replayed v1's refusal for new platforms
      // (ADR 0020 amendment).
      idempotencyKey: `daybell-payout-account-v2-${studio.id}`,
    });
    const { status, facts, schedule } = accountForDatabase(account);
    const recorded = await payoutWriteRpc(studio.region, "create_payout_account", userId, {
      p_studio_id: studio.id,
      p_stripe_account_id: account.id,
      p_livemode: provider.livemode,
      p_facts: facts,
      p_schedule: schedule,
      p_status: status,
      p_fetched_at: fetchedAt,
    });
    // Security review N4: Stripe has the account but Daybell doesn't. The studio id only (never the Stripe id or
    // anything personal); support matches it to the account's daybell_studio_id metadata.
    if (recorded.error) console.error("stripe_account_unrecorded", studio.id);
    payoutResult(recorded);
    accountId = account.id;
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
