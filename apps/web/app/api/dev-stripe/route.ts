import { ApiError } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { loadPayoutAccountRow } from "@/lib/payouts";
import { isFakeStripe, signStripeBody, webhookSecrets } from "@/lib/stripe";
import {
  fakeFinishOnboarding,
  fakeId,
  fakePaidPayout,
  fakeReturnUrl,
  isFakeAccount,
} from "@/lib/stripe/fake-driver";
import { handleStripeWebhook } from "@/lib/stripe-webhook";
import { assertCanManagePayouts, studioScope } from "@/lib/studio";

export const runtime = "nodejs";

/**
 * The fake Stripe's controls (STRIPE_DRIVER=fake only: development, CI and end-to-end tests; ADR 0020). With any other
 * driver, and always on Vercel, this route doesn't exist (404). Not part of /api/v1. Acts on the signed-in owner's own
 * studio's account only, and tells Daybell through its real webhook with a correctly signed event:
 * - finish: the owner completes "Stripe's" onboarding (account.updated);
 * - leave: they leave it unfinished;
 * - payoutPaid: Stripe pays the studio (payout.paid).
 */
const input = z.strictObject({ action: z.enum(["finish", "leave", "payoutPaid"]) });

async function sendEvent(type: string, account: string, object: { id: string }): Promise<void> {
  const body = JSON.stringify({
    id: fakeId("evt"),
    object: "event",
    type,
    account,
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: "2026-08-26.dahlia",
    data: { object },
  });
  const [secret] = webhookSecrets();
  const response = await handleStripeWebhook(
    new Request(`${siteUrl()}/api/v1/webhooks/stripe`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "stripe-signature": signStripeBody(body, secret as string),
      },
      body,
    }),
  );
  if (!response.ok) throw new ApiError("internal", "The fake webhook failed.");
}

export const POST = handle(async (request: Request) => {
  if (process.env.VERCEL || !isFakeStripe()) return new Response(null, { status: 404 });
  const { supabase, studio } = await studioScope();
  assertCanManagePayouts(studio);
  const { action } = await parseBody(request, input);
  const row = await loadPayoutAccountRow(supabase, studio.id);
  if (!row || !isFakeAccount(row.stripe_account_id))
    throw new ApiError("not_found", "No fake Stripe account.");
  const account = row.stripe_account_id;
  if (action === "finish") {
    fakeFinishOnboarding(account);
    await sendEvent("account.updated", account, { id: account });
  }
  if (action === "payoutPaid") {
    const payout = fakePaidPayout(account, studio.region === "ca" ? "cad" : "usd");
    await sendEvent("payout.paid", account, { id: payout });
  }
  return Response.json({
    returnUrl: fakeReturnUrl(account) ?? `${siteUrl()}/app/settings/payouts`,
  });
});
