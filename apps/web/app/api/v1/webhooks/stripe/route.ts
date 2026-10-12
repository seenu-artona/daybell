import { handle } from "@/lib/api";
import { handleStripeWebhook } from "@/lib/stripe-webhook";

export const runtime = "nodejs";
// Canadian studios' payout work runs in Montréal (D113; ADR 0020).
export const preferredRegion = "yul1";

/**
 * POST /api/v1/webhooks/stripe — Stripe's events from connected accounts (ADR 0020). Signed with Stripe-Signature;
 * nobody signed in calls it. See lib/stripe-webhook.ts for each step.
 */
export const POST = handle(async (request: Request) => handleStripeWebhook(request));
