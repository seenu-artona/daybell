import "server-only";
import { ApiError, PAYOUT_NOT_CONFIGURED } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import { type StripeSettings, stripeSettings, stripeWebhookSecrets } from "@daybell/config/server";
import Stripe from "stripe";
import { fakeDriver } from "./fake-driver";
import { stripeDriver } from "./stripe-driver";
import type { PaymentsProvider } from "./types";

export { StripeCallError, type StripeOutcome, type StripeStage } from "./errors";
export type * from "./types";
export { DEFAULT_SCHEDULE, SCHEDULE_SET_KEY } from "./types";

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

/** Whether Stripe is set up in this deployment at all (STRIPE_DRIVER set); never throws. */
export function paymentsConfigured(): boolean {
  try {
    return stripeSettings() !== null;
  } catch {
    return false;
  }
}

/** Whether STRIPE_DRIVER=fake (and so off Vercel): the fake onboarding page and simulator exist only then. */
export function isFakeStripe(): boolean {
  try {
    return stripeSettings()?.driver === "fake";
  } catch {
    return false;
  }
}

function stripeHost(url: string): string {
  try {
    const host = new URL(url).hostname;
    return host === "stripe.com" || host.endsWith(".stripe.com") ? host : "other";
  } catch {
    return "other";
  }
}

/**
 * Where a Stripe link may send the owner (security review N5): Stripe's own Connect pages for the real driver, this
 * deployment's fake pages for the fake one. Anything else is refused before it reaches the browser (logged by a fixed
 * name and, if it is Stripe's, the host; never the address).
 */
export function assertStripeLink(url: string, driver: PaymentsProvider["driver"]): string {
  const allowed = driver === "stripe" ? "https://connect.stripe.com/" : `${siteUrl()}/`;
  if (!url.startsWith(allowed)) {
    // The host only if it is one of Stripe's (so a link from a new Stripe host is diagnosable), never the address.
    console.error("stripe_link_unexpected", driver, stripeHost(url));
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  return url;
}

/**
 * Where a checkout may send a parent (ADR 0023): Stripe's hosted checkout for the real driver, this deployment's fake
 * page for the fake one. Anything else is refused before it reaches the browser (logged by a fixed name and Stripe's
 * host, never the address).
 */
export function assertCheckoutLink(url: string, driver: PaymentsProvider["driver"]): string {
  const allowed =
    driver === "stripe" ? "https://checkout.stripe.com/" : `${siteUrl()}/dev/stripe-checkout?`;
  if (!url.startsWith(allowed)) {
    console.error("stripe_checkout_link_unexpected", driver, stripeHost(url));
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

/** A v2 "thin" event notification: ids, the type and the time only; Daybell reads the object from Stripe itself. */
export interface ThinStripeEvent {
  id: string;
  object: "v2.core.event";
  type: string;
  livemode: boolean;
  /** RFC 3339. */
  created: string;
  related_object?: { id?: unknown; type?: unknown } | null;
  /** The connected account the event happened on, for events about one. */
  context?: unknown;
}

export type VerifiedStripeEvent =
  | { payload: "snapshot"; event: Stripe.Event }
  | { payload: "thin"; event: ThinStripeEvent };

/**
 * A Stripe event from a webhook body, if its Stripe-Signature matches one of the secrets within Stripe's default
 * five-minute tolerance; otherwise null. Snapshot (v1, `object: "event"`) and thin (v2, `object: "v2.core.event"`)
 * events are signed the same way (stripe-node's constructEvent and parseEventNotification both use
 * webhooks.signature.verifyHeader), so one check covers both and the body's `object` says which it is. Never logs the
 * body.
 */
export function verifyStripeWebhook(
  body: string,
  signature: string | null,
  secrets: readonly string[],
): VerifiedStripeEvent | null {
  if (!signature) return null;
  const check = Stripe.webhooks.signature;
  if (!check) return null;
  const verified = secrets.some((secret) => {
    try {
      return check.verifyHeader(body, signature, secret, Stripe.webhooks.DEFAULT_TOLERANCE);
    } catch {
      // Try the next secret (one per destination, and two during a rotation).
      return false;
    }
  });
  if (!verified) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return null;
  }
  const object = (parsed as { object?: unknown } | null)?.object;
  if (object === "event") return { payload: "snapshot", event: parsed as Stripe.Event };
  if (object === "v2.core.event") return { payload: "thin", event: parsed as ThinStripeEvent };
  return null;
}

/** A correctly signed header for a body, as Stripe would send it (the fake driver's simulated events and tests). */
export function signStripeBody(body: string, secret: string): string {
  return Stripe.webhooks.generateTestHeaderString({ payload: body, secret });
}
