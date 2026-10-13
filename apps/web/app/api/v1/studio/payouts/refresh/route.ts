import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import {
  loadPayoutAccountRow,
  loadStudioPayouts,
  NOT_CONNECTED,
  payoutResult,
  stripeFetchTime,
  syncAccountCopy,
  takeStripeCall,
  withDefaultSchedule,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/payouts/refresh — reads the studio's account from Stripe now and updates Daybell's copy (ADR
 * 0020): on coming back from Stripe, so the status is right even where no webhook arrives (PR previews) or it is late.
 * Owners and admins. The account is the studio's own, from the database. Counts against the studio's Stripe budget.
 * Sets Daybell's default payout schedule if it hasn't been set yet (its first try, after the account was recorded,
 * failed; security review 1).
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
  const account = await withDefaultSchedule(
    provider,
    row.stripe_account_id,
    await provider.retrieveAccount(row.stripe_account_id),
  );
  payoutResult(await syncAccountCopy(studio.region, row.stripe_account_id, account, fetchedAt));
  return NextResponse.json(await loadStudioPayouts(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
