import { payoutScheduleInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  accountForDatabase,
  loadPayoutAccountRow,
  loadStudioPayouts,
  NOT_CONNECTED,
  payoutResult,
} from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { assertOwner, studioScope } from "@/lib/studio";
import { payoutWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * PUT /api/v1/studio/payouts/schedule — the owner picks weekly on a weekday, daily, or monthly on a date (Seenu, answer
 * 3 and Q6; D56). Stripe's delay is left alone. Stripe is changed first; Daybell then saves the schedule Stripe
 * answered with, so the copy never says something Stripe doesn't.
 */
export const PUT = handle(async (request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  assertOwner(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, payoutScheduleInput);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row) throw NOT_CONNECTED();
  const account = await payments().updatePayoutSchedule(row.stripe_account_id, input);
  payoutResult(
    await payoutWriteRpc(studio.region, "set_payout_schedule", userId, {
      p_studio_id: studio.id,
      p_schedule: accountForDatabase(account).schedule,
    }),
  );
  return NextResponse.json(await loadStudioPayouts(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
