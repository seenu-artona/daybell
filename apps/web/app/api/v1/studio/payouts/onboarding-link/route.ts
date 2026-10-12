import type { PayoutLinkResponse } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  accountForDatabase,
  countryForRegion,
  loadPayoutAccountRow,
  payoutResult,
  payoutsReturnUrl,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { assertOwner, studioScope } from "@/lib/studio";
import { payoutWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/onboarding-link — the owner sets up (or carries on setting up) payouts on Stripe's own
 * pages (Seenu, answers 1 and 2). The first time, it creates the studio's Stripe account (country, controller
 * properties, capabilities and Daybell's ids only; Q1, Q4) with an idempotency key, so a retry never makes a second
 * account, then records it. Each call makes a new single-use Account Link. The link is never logged.
 */
export const POST = handle(async () => {
  const { supabase, studio, userId } = await studioScope();
  assertOwner(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const provider = payments();
  let accountId = (await loadPayoutAccountRow(supabase, studio.id))?.stripe_account_id ?? null;
  if (!accountId) {
    const account = await provider.createAccount({
      studioId: studio.id,
      region: studio.region,
      country: countryForRegion(studio.region),
      idempotencyKey: `daybell-payout-account-${studio.id}`,
    });
    const { status, facts, schedule } = accountForDatabase(account);
    payoutResult(
      await payoutWriteRpc(studio.region, "create_payout_account", userId, {
        p_studio_id: studio.id,
        p_stripe_account_id: account.id,
        p_livemode: provider.livemode,
        p_facts: facts,
        p_schedule: schedule,
        p_status: status,
      }),
    );
    accountId = account.id;
  }
  const link = await provider.createAccountLink({
    accountId,
    refreshUrl: payoutsReturnUrl("refresh"),
    returnUrl: payoutsReturnUrl("return"),
  });
  const body: PayoutLinkResponse = {
    url: link.url,
    expiresAt: new Date(link.expiresAt * 1000).toISOString(),
  };
  return NextResponse.json(body, { headers: { "cache-control": "private, no-store" } });
});
