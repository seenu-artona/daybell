import { ApiError } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { z } from "zod";
import { handle, parseBody } from "@/lib/api";
import { isFakeStripe, signStripeBody, webhookSecrets } from "@/lib/stripe";
import {
  fakeCancelCheckout,
  fakeCheckoutSummary,
  fakeId,
  fakePayCheckout,
} from "@/lib/stripe/fake-driver";
import { handleStripeWebhook } from "@/lib/stripe-webhook";

export const runtime = "nodejs";

/**
 * The fake Stripe's hosted checkout (STRIPE_DRIVER=fake only: development, CI and end-to-end tests; ADR 0023). With any
 * other driver, and always on Vercel, this route doesn't exist (404), before anything is read. Not part of /api/v1.
 * Parents aren't signed in: a checkout is named by its id, which only the parent's own browser was sent. Acts on that
 * checkout only:
 * - pay: "Stripe" takes the payment and tells Daybell through its real webhook with a correctly signed
 *   checkout.session.completed, then answers where Stripe would send the parent (the order page);
 * - cancel: where Stripe's back link goes (the bag, which cancels the checkout).
 * The email and address typed here stay in the fake's memory, like Stripe's own.
 */
const input = z.discriminatedUnion("action", [
  z.strictObject({
    action: z.literal("pay"),
    session: z.string().regex(/^cs_test_fake[A-Za-z0-9]{1,64}$/),
    email: z.email().max(254),
    shipping: z
      .strictObject({
        name: z.string().trim().min(1).max(200),
        line1: z.string().trim().min(1).max(200),
        line2: z.string().trim().max(200).nullable(),
        city: z.string().trim().min(1).max(100),
        state: z.string().trim().max(100).nullable(),
        postalCode: z.string().trim().min(1).max(20),
        country: z.literal("CA"),
      })
      .nullable(),
  }),
  z.strictObject({
    action: z.literal("cancel"),
    session: z.string().regex(/^cs_test_fake[A-Za-z0-9]{1,64}$/),
  }),
]);

async function sendCompleted(sessionId: string): Promise<void> {
  const body = JSON.stringify({
    id: fakeId("evt"),
    object: "event",
    type: "checkout.session.completed",
    livemode: false,
    created: Math.floor(Date.now() / 1000),
    api_version: "2026-08-26.dahlia",
    data: { object: { id: sessionId, object: "checkout.session" } },
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
  const body = await parseBody(request, input);
  if (!fakeCheckoutSummary(body.session)) throw new ApiError("not_found", "No fake checkout.");
  if (body.action === "cancel")
    return Response.json({ redirect: fakeCancelCheckout(body.session) });
  let redirect: string;
  try {
    redirect = fakePayCheckout(body.session, { email: body.email, shipping: body.shipping });
  } catch {
    throw new ApiError("conflict", "This checkout can't be paid.");
  }
  await sendCompleted(body.session);
  return Response.json({ redirect });
});
