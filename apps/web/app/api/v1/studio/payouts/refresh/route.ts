import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  accountForDatabase,
  loadPayoutAccountRow,
  loadStudioPayouts,
  NOT_CONNECTED,
  payoutResult,
  stripeFetchTime,
  takeStripeCall,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";
import { payoutSystemRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/refresh — reads the studio's account from Stripe now and updates Daybell's copy (ADR
 * 0020): on coming back from Stripe, so the status is right even where no webhook arrives (PR previews) or it is late.
 * Owners and admins. The account is the studio's own, from the database. Counts against the studio's Stripe budget.
 */
export const POST = handle(async () => {
  const { supabase, studio } = await studioScope();
  assertCanSeePayouts(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row) throw NOT_CONNECTED();
  const provider = payments();
  await takeStripeCall(studio);
  const fetchedAt = stripeFetchTime();
  const account = await provider.retrieveAccount(row.stripe_account_id);
  const { status, facts, schedule } = accountForDatabase(account);
  payoutResult(
    await payoutSystemRpc(studio.region, "sync_payout_account", {
      p_stripe_account_id: row.stripe_account_id,
      p_facts: facts,
      p_schedule: schedule,
      p_status: status,
      p_fetched_at: fetchedAt,
    }),
  );
  return NextResponse.json(await loadStudioPayouts(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
