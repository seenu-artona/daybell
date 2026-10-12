import "server-only";
import { ApiError, PAYOUT_NOT_CONFIGURED } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { type StripeSettings, stripeSettings, stripeWebhookSecrets } from "@daybell/config/server";
import Stripe from "stripe";
import { fakeDriver } from "./fake-driver";
import { stripeDriver } from "./stripe-driver";
import type { PaymentsProvider } from "./types";

export type * from "./types";

/**
 * Daybell's Stripe (ADR 0020), from STRIPE_DRIVER: the real API or the fake. Misconfiguration is logged by variable
 * name only. Where STRIPE_DRIVER isn't set (PR previews, Claude's call Q13), payouts aren't set up and nothing calls
 * Stripe.
 */
let cached: { settings: StripeSettings; provider: PaymentsProvider } | null = null;

function settings(): StripeSettings | null {
  try {
    return stripeSettings();
  } catch (err) {
    console.error("stripe_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
}

export function payments(): PaymentsProvider {
  const current = settings();
  // Its own form code, so the screen says "not set up in this environment", not "not available in this region".
  if (!current)
    throw new ApiError("region_unavailable", "Payouts aren't set up in this environment.", {
      form: PAYOUT_NOT_CONFIGURED,
    });
  if (cached && JSON.stringify(cached.settings) === JSON.stringify(current)) return cached.provider;
  const provider =
    current.driver === "fake" ? fakeDriver() : stripeDriver(current.secretKey, current.livemode);
  cached = { settings: current, provider };
  return provider;
}

/** Whether STRIPE_DRIVER=fake (and so off Vercel): the fake onboarding page and simulator exist only then. */
export function isFakeStripe(): boolean {
  try {
    return stripeSettings()?.driver === "fake";
  } catch {
    return false;
  }
}

/**
 * Where a Stripe link may send the owner (security review N5): Stripe's own Connect pages for the real driver, this
 * deployment's fake pages for the fake one. Anything else is refused before it reaches the browser (logged by a fixed
 * name only, never the address).
 */
export function assertStripeLink(url: string, driver: PaymentsProvider["driver"]): string {
  const allowed = driver === "stripe" ? "https://connect.stripe.com/" : `${siteUrl()}/`;
  if (!url.startsWith(allowed)) {
    console.error("stripe_link_unexpected", driver);
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  return url;
}

/** The webhook's signing secrets; misconfiguration logged by name only. */
export function webhookSecrets(): string[] {
  try {
    return stripeWebhookSecrets();
  } catch (err) {
    console.error("stripe_misconfigured", err instanceof Error ? err.message : "unknown");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
}

/**
 * A Stripe event from a webhook body, if its Stripe-Signature matches one of the secrets within Stripe's default
 * five-minute tolerance (stripe-node's webhooks.constructEvent); otherwise null. Never logs the body.
 */
export function verifyStripeEvent(
  body: string,
  signature: string | null,
  secrets: readonly string[],
): Stripe.Event | null {
  if (!signature) return null;
  for (const secret of secrets) {
    try {
      return Stripe.webhooks.constructEvent(body, signature, secret);
    } catch {
      // Try the next secret (two during a rotation).
    }
  }
  return null;
}

/** A correctly signed header for a body, as Stripe would send it (the fake driver's simulated events and tests). */
export function signStripeBody(body: string, secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}
