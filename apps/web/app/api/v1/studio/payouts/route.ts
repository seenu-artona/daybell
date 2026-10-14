import { NextResponse } from "next/server";
import { handle } from "@/lib/api";
import { loadStudioPayouts } from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { assertCanSeePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";
// Canadian studios' payout work runs in Montréal (D113; ADR 0020).
export const preferredRegion = "yul1";

/**
 * GET /api/v1/studio/payouts — Settings › Stripe (D56, D98, D150; Seenu, answer 4): status, schedule, next payout day,
 * the latest payouts and the fees. Owners and admins (answer 1); Canadian studios only for now (Q3). Daybell's copy
 * only: no Stripe call (Q9).
 */
export const GET = handle(async () => {
  const { supabase, studio } = await studioScope();
  assertCanSeePayouts(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  return NextResponse.json(await loadStudioPayouts(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
