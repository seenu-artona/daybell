import { createHash } from "node:crypto";
import { taxRegistrationInput } from "@daybell/api";
import { NextResponse } from "next/server";
import { handle, parseBody } from "@/lib/api";
import {
  ALREADY_REGISTERED,
  assertCanManageTaxes,
  HEAD_OFFICE_REQUIRED,
  loadStudioTaxes,
  TAXES_NOT_CONNECTED,
  taxResult,
} from "@/lib/checkout/taxes";
import { loadPayoutAccountRow, takeStripeCall } from "@/lib/payouts";
import { assertFunctionRegion, assertPayoutRegion } from "@/lib/region-guard";
import { payments } from "@/lib/stripe";
import { studioScope } from "@/lib/studio";
import { taxWriteRpc } from "@/lib/supabase/service";

export const runtime = "nodejs";
export const preferredRegion = "yul1";

/**
 * POST /api/v1/studio/taxes/registrations — a GST/HST registration, or PST in BC, MB or SK (answer 2). The owner (call
 * 6). Checked here first (a business address, not already registered), so Stripe isn't asked for what would be
 * refused; registered with Stripe (GST/HST as "standard", PST as "province_standard"), then kept with its number. The
 * idempotency key holds the number's hash, never the number.
 */
export const POST = handle(async (request: Request) => {
  const { supabase, studio, userId } = await studioScope();
  assertCanManageTaxes(studio);
  assertPayoutRegion(studio.region);
  assertFunctionRegion(studio.region);
  const input = await parseBody(request, taxRegistrationInput);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row) throw TAXES_NOT_CONNECTED();
  const current = await loadStudioTaxes(supabase, studio);
  if (!current.headOffice) throw HEAD_OFFICE_REQUIRED();
  const province = input.kind === "pst" ? input.province : null;
  if (current.registrations.some((r) => r.kind === input.kind && r.province === province))
    throw ALREADY_REGISTERED();
  const provider = payments();
  await takeStripeCall(studio);
  const numberHash = createHash("sha256").update(input.number).digest("hex").slice(0, 24);
  const created = await provider.createTaxRegistration(
    row.stripe_account_id,
    input.kind === "pst" ? { kind: "pst", province: input.province } : { kind: "gst_hst" },
    `daybell-taxreg-${studio.id}-${input.kind}-${province ?? "ca"}-${numberHash}`,
  );
  try {
    taxResult(
      await taxWriteRpc(studio.region, "add_tax_registration", userId, {
        p_studio_id: studio.id,
        p_kind: input.kind,
        p_province: province,
        p_number: input.number,
        p_stripe_registration_id: created.id,
      }),
    );
  } catch (err) {
    // Stripe has it but Daybell couldn't keep it (e.g. two owners' tabs at once): support reconciles. Never the number.
    console.error("stripe_tax_registration_unrecorded");
    throw err;
  }
  return NextResponse.json(await loadStudioTaxes(supabase, studio), {
    status: 201,
    headers: { "cache-control": "private, no-store" },
  });
});
