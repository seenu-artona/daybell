import { ApiError } from "@daybell/api";
import { NextResponse } from "next/server";
import { check, handle } from "@/lib/api";
import {
  assertCanManageTaxes,
  loadStudioTaxes,
  TAXES_NOT_CONNECTED,
  taxResult,
} from "@/lib/checkout/taxes";
import { loadPayoutAccountRow, takeStripeCall } from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { pathId } from "@/lib/roster";
import { payments } from "@/lib/stripe";
import { studioScope } from "@/lib/studio";
import { taxWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

type Ctx = { params: Promise<{ id: string }> };

/**
 * DELETE /api/v1/studio/taxes/registrations/:id — ends a registration: expired at Stripe first (Stripe keeps its
 * history), then ended here. New checkouts stop charging that tax. The owner (call 6).
 */
export const DELETE = handle(async (_request: Request, ctx: Ctx) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanManageTaxes(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const id = await pathId(ctx, "Registration not found.");
  const registration = check(
    await supabase
      .from("studio_tax_registrations")
      .select("id, stripe_registration_id")
      .eq("studio_id", studio.id)
      .eq("id", id)
      .is("ended_at", null)
      .maybeSingle(),
  ) as { id: string; stripe_registration_id: string } | null;
  if (!registration) throw new ApiError("not_found", "Registration not found.");
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row) throw TAXES_NOT_CONNECTED();
  const provider = payments();
  await takeStripeCall(studio);
  await provider.expireTaxRegistration(row.stripe_account_id, registration.stripe_registration_id);
  taxResult(
    await taxWriteRpc(studio.region, "end_tax_registration", userId, {
      p_studio_id: studio.id,
      p_id: id,
    }),
  );
  return NextResponse.json(await loadStudioTaxes(supabase, studio), {
    headers: { "cache-control": "private, no-store" },
  });
});
