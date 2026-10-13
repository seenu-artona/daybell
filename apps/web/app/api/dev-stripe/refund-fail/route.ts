import { ApiError } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { isFakeStripe, signStripeBody, webhookSecrets } from "@/lib/stripe";
import { fakeFailRefund, fakeId } from "@/lib/stripe/fake-driver";
import { handleStripeWebhook } from "@/lib/stripe-webhook";

export const runtime = "nodejs";

/**
 * The fake Stripe failing a refund after it was made (STRIPE_DRIVER=fake only: development, CI and end-to-end tests;
 * ADR 0024), like a closed card: the refund's status becomes failed and Daybell hears it through its real webhook, with
 * a correctly signed refund.failed. With any other driver, and always on Vercel, this route doesn't exist (404), before
 * anything is read. Not part of /api/v1.
 */
const input = z.strictObject({ refund: z.string().regex(/^re_fake[A-Za-z0-9]{1,64}$/) });

export const POST = handle(async (request: Request) => {
  if (process.env.VERCEL || !isFakeStripe()) return new Response(null, { status: 404 });
  const { refund } = await parseBody(request, input);
  if (!fakeFailRefund(refund)) throw new ApiError("not_found", "No fake refund.");
  const body = JSON.stringify({
    id: fakeId("evt"),
    object: "event",
    type: "refund.failed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: "2026-08-26.dahlia",
    data: { object: { id: refund, object: "refund" } },
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
  return new Response(null, { status: 204 });
});
