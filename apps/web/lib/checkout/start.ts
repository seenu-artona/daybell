import "server-only";
import { ApiError, SHOP_CHECKOUT_NOT_CONFIGURED, SHOP_CONFLICTS } from "@daybell/api";
import { siteUrl } from "@daybell/config";
import type { Currency, PriceItemKind, ShopShippingMethod } from "@daybell/core";
import { createTranslator } from "next-intl";
import enCA from "@/messages/en-CA.json";
import enUS from "@/messages/en-US.json";
import { assertFunctionRegion, assertPayoutRegion } from "../region-guard";
import { callShopFunction } from "../shop/http";
import type { ShopCookieSession } from "../shop/session";
import { assertCheckoutLink, type PaymentsProvider, payments } from "../stripe";
import { checkoutSystemRpc } from "../supabase/service";
import { CheckoutProblem, closeCheckout, completeCheckout, expireOrder } from "./complete";
import { checkoutParams } from "./stripe-params";

/**
 * Starting and cancelling a parent's checkout (ADR 0023 §5.1). The database prices the bag and writes the order; Stripe
 * is asked only after that, in the session's region's function region (D113), and never with anything the browser
 * sent. Two open checkouts for one bag are never both payable: a replaced checkout is expired at Stripe first, and
 * one Stripe says was paid meanwhile becomes the parent's order (409 shop.alreadyPaid).
 */

/** Stripe for the shop: payouts' provider, with the shop's own "not set up here" refusal. */
export function checkoutPayments(): PaymentsProvider {
  try {
    return payments();
  } catch (err) {
    if (err instanceof ApiError && err.code === "region_unavailable")
      throw new ApiError("region_unavailable", "Payments aren't set up in this environment.", {
        form: SHOP_CHECKOUT_NOT_CONFIGURED,
      });
    throw err;
  }
}

const alreadyPaid = (orderId: string) =>
  new ApiError("conflict", "This bag has just been paid for.", {
    form: SHOP_CONFLICTS.alreadyPaid,
    orderId,
  });

interface Begun {
  outcome: "created" | "reuse";
  order_id: string;
  reference: string;
  created_at: string;
  checkout_session_id: string | null;
  superseded: string[];
  studio_id: string;
  studio_name: string;
  currency: Currency;
  stripe_account_id: string;
  card_prefix_set: boolean;
  tax_enabled: boolean;
  shipping_method: ShopShippingMethod | null;
  shipping_cents: number;
  products_cents: number;
  daybell_fee_cents: number;
  lines: { kind: PriceItemKind; name: string; unit_price_cents: number; quantity: number }[];
}

/** The words Stripe shows, in the studio's region's English (D96). */
function checkoutText(region: "ca" | "us", studio: string) {
  const t = createTranslator({
    locale: region === "ca" ? "en-CA" : "en-US",
    messages: region === "ca" ? enCA : enUS,
    namespace: "shop.checkout.stripe",
  });
  return { processedBy: t("processedBy", { studio }), homeShipping: t("homeShipping") };
}

/** The card prefix "DBL" on the studio's account (call 7), once; a failure never stops a parent paying. */
async function ensureCardPrefix(region: "ca" | "us", provider: PaymentsProvider, begun: Begun) {
  if (begun.card_prefix_set) return;
  try {
    await provider.setCardPrefix(begun.stripe_account_id);
    const { error } = await checkoutSystemRpc(region, "mark_card_prefix_set", {
      p_stripe_account_id: begun.stripe_account_id,
    });
    if (error) console.error("checkout_card_prefix_unrecorded");
  } catch {
    console.error("stripe_card_prefix_failed");
  }
}

const begin = (session: ShopCookieSession) =>
  callShopFunction<Begun>(session.region, "shop_checkout_begin", { p_session_hash: session.hash });

/** POST /shop/checkout: the order and Stripe's address for it. */
export async function startCheckout(
  session: ShopCookieSession,
): Promise<{ orderId: string; url: string }> {
  const region = session.region;
  // US studios don't take payments yet (ADR 0020), before anything is written or asked.
  assertPayoutRegion(region);
  assertFunctionRegion(region);
  const provider = checkoutPayments();
  let begun = await begin(session);

  for (let tries = 0; ; tries++) {
    for (const old of begun.superseded) {
      const { status } = await provider.expireCheckoutSession(old);
      if (status === "complete") {
        const paid = await completeCheckout(region, provider, old);
        if (paid.outcome !== "unpaid") throw alreadyPaid(paid.orderId);
      }
    }
    if (begun.outcome !== "reuse" || !begun.checkout_session_id) break;
    // The same bag's checkout: still open at Stripe is used again; paid meanwhile is the parent's order.
    const facts = await provider.retrieveCheckoutSession(begun.checkout_session_id);
    if (facts.status === "open" && facts.url)
      return { orderId: begun.order_id, url: assertCheckoutLink(facts.url, provider.driver) };
    if (facts.status === "complete") {
      const paid = await completeCheckout(region, provider, facts.id, {
        expectedOrderId: begun.order_id,
        known: facts,
      });
      if (paid.outcome !== "unpaid") throw alreadyPaid(paid.orderId);
    }
    // Run out at Stripe before here: that order ends, and the bag gets a new one (once).
    if (tries > 0) throw new ApiError("internal", "Something went wrong on our side.");
    await expireOrder(region, begun.order_id);
    begun = await begin(session);
  }

  await ensureCardPrefix(region, provider, begun);
  const params = checkoutParams(
    {
      orderId: begun.order_id,
      studioId: begun.studio_id,
      region,
      galleryId: session.galleryId,
      studioName: begun.studio_name,
      currency: begun.currency,
      destination: begun.stripe_account_id,
      lines: begun.lines.map((l) => ({
        kind: l.kind,
        name: l.name,
        unitPriceCents: Number(l.unit_price_cents),
        quantity: l.quantity,
      })),
      shippingMethod: begun.shipping_method,
      shippingCents: Number(begun.shipping_cents),
      taxEnabled: begun.tax_enabled,
      daybellFeeCents: Number(begun.daybell_fee_cents),
      createdAt: Math.floor(Date.parse(begun.created_at) / 1000),
    },
    checkoutText(region, begun.studio_name),
    siteUrl(),
  );
  // The order's own key: a retry (the attach below failed) gets the same checkout, never a second one.
  const created = await provider.createCheckoutSession(
    params,
    `daybell-checkout-${begun.order_id}`,
  );
  await callShopFunction(region, "shop_checkout_attach", {
    p_session_hash: session.hash,
    p_order_id: begun.order_id,
    p_checkout_session_id: created.id,
    p_expires_at: new Date(created.expiresAt * 1000).toISOString(),
  });
  return { orderId: begun.order_id, url: assertCheckoutLink(created.url, provider.driver) };
}

/**
 * POST /shop/checkout/cancel: back from Stripe without paying. Every open checkout of the gallery is expired at Stripe
 * and here, so a stale tab can't pay later; one Stripe says was paid meanwhile is completed instead. The bag stays.
 */
export async function cancelCheckout(session: ShopCookieSession): Promise<void> {
  const region = session.region;
  assertPayoutRegion(region);
  const pending = await callShopFunction<
    { order_id: string; checkout_session_id: string | null }[]
  >(region, "shop_pending_checkouts", { p_session_hash: session.hash });
  if (pending.length === 0) return;
  const provider = checkoutPayments();
  for (const order of pending) {
    try {
      await closeCheckout(region, provider, order.order_id, order.checkout_session_id);
    } catch (err) {
      // Never expected (Stripe's answer didn't match the order): left for support; the parent's bag is fine.
      if (err instanceof CheckoutProblem) console.error("checkout_cancel_problem", err.code);
      else throw err;
    }
  }
}
