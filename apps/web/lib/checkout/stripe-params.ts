import { TAX_CODES } from "@daybell/config";
import {
  CHECKOUT_MINUTES,
  type Currency,
  type PriceItemKind,
  type ShopShippingMethod,
  statementSuffix,
} from "@daybell/core";
import { DEFAULT_STUDIO_COLOR, studioColorHex } from "@daybell/ui/studio-colors";
import type { CheckoutSessionParams } from "../stripe/types";

/**
 * Stripe's hosted checkout for an order (ADR 0023 §4; D97, D106, D104, D24, D59). Pure: the order's snapshot in,
 * stripe-node's own parameter type out (so every field is checked against stripe-node 22.6.2). What Stripe receives:
 * item names and prices, the studio's name, Daybell's ids and the words in the locale files. Never a child's name, a
 * photo, an email or anything the browser sent.
 */
export interface CheckoutOrder {
  orderId: string;
  studioId: string;
  region: "ca" | "us";
  /** The gallery the parent pays from, for the way back. */
  galleryId: string;
  studioName: string;
  currency: Currency;
  /** The studio's Stripe account: the destination and the seller (D106). */
  destination: string;
  lines: readonly {
    kind: PriceItemKind;
    name: string;
    unitPriceCents: number;
    quantity: number;
  }[];
  shippingMethod: ShopShippingMethod | null;
  shippingCents: number;
  /** Stripe Tax on: the studio has a registration and a head office (answer 2). */
  taxEnabled: boolean;
  /** Daybell's fee, the application fee (call 1: Stripe's fee is recovered afterwards). */
  daybellFeeCents: number;
  /** When the order was made (seconds): the checkout's expiry is fixed from it, so a retried create is identical. */
  createdAt: number;
}

/** The words Stripe shows, from the locale files (D96). */
export interface CheckoutText {
  /** "Payments processed by Daybell for {studio}" (D104). */
  processedBy: string;
  /** The home delivery option's name. */
  homeShipping: string;
}

/** The parent's way back, always this deployment's own pages (never one from the request). */
export function checkoutReturnUrls(siteUrl: string, orderId: string, galleryId: string) {
  const gallery = encodeURIComponent(galleryId);
  return {
    successUrl: `${siteUrl}/shop/orders/${orderId}?gallery=${gallery}`,
    cancelUrl: `${siteUrl}/shop/bag?gallery=${gallery}&checkout=canceled`,
  };
}

/**
 * The checkout lasts just over Stripe's 30-minute minimum, counted from the order (ADR 0023; call 17): 2 minutes over,
 * so a create retried up to the end of the database's 45-second reuse window (plus the trip to Stripe) is still at
 * least 30 minutes ahead, as Stripe requires (code review S5).
 */
export const CHECKOUT_EXPIRY_MARGIN_MINUTES = 2;
export function checkoutExpiresAt(createdAtSeconds: number): number {
  return createdAtSeconds + (CHECKOUT_MINUTES + CHECKOUT_EXPIRY_MARGIN_MINUTES) * 60;
}

export function checkoutParams(
  order: CheckoutOrder,
  text: CheckoutText,
  siteUrl: string,
): CheckoutSessionParams {
  const currency = order.currency.toLowerCase();
  const ids = {
    daybell_order_id: order.orderId,
    daybell_studio_id: order.studioId,
    daybell_region: order.region,
  };
  const { successUrl, cancelUrl } = checkoutReturnUrls(siteUrl, order.orderId, order.galleryId);
  const suffix = statementSuffix(order.studioName);
  const home = order.shippingMethod === "home";
  return {
    mode: "payment",
    ui_mode: "hosted_page",
    locale: "auto",
    submit_type: "pay",
    // Cards, with Apple Pay and Google Pay through them once switched on in the Dashboard (answer 3). Never Link
    // (call 19): it would keep parents' details at Stripe.
    payment_method_types: ["card"],
    wallet_options: { link: { display: "never" } },
    // No Stripe customer (D24: no sign-up); Checkout asks for the email itself.
    customer_creation: "if_required",
    expires_at: checkoutExpiresAt(order.createdAt),
    client_reference_id: order.orderId,
    metadata: ids,
    line_items: order.lines.map((line) => ({
      quantity: line.quantity,
      price_data: {
        currency,
        unit_amount: line.unitPriceCents,
        // Prices are before tax (ADR 0019).
        tax_behavior: "exclusive",
        product_data: { name: line.name, tax_code: TAX_CODES[line.kind] },
      },
    })),
    // Home delivery: Stripe collects the recipient's address, in Canada only (call 2). School delivery collects none.
    ...(home
      ? {
          shipping_address_collection: { allowed_countries: ["CA"] },
          shipping_options: [
            {
              shipping_rate_data: {
                type: "fixed_amount",
                display_name: text.homeShipping,
                fixed_amount: { amount: order.shippingCents, currency },
                tax_behavior: "exclusive",
                tax_code: TAX_CODES.shipping,
              },
            },
          ],
        }
      : {}),
    // Stripe Tax with the studio's registrations, the studio liable (D106; answer 2); none without a registration.
    automatic_tax: order.taxEnabled
      ? { enabled: true, liability: { type: "account", account: order.destination } }
      : { enabled: false },
    payment_intent_data: {
      // A destination charge on behalf of the Canadian studio: it is the seller and settles in CAD (D106).
      on_behalf_of: order.destination,
      transfer_data: { destination: order.destination },
      application_fee_amount: order.daybellFeeCents,
      description: text.processedBy,
      metadata: ids,
      // "DBL* RIVERSIDE PHOTO" (D104; call 7).
      ...(suffix ? { statement_descriptor_suffix: suffix } : {}),
    },
    custom_text: { submit: { message: text.processedBy } },
    // The studio's name and the charcoal button (call 8: logos later; D112, D116), from the design tokens.
    branding_settings: {
      display_name: order.studioName,
      button_color: studioColorHex(DEFAULT_STUDIO_COLOR),
    },
    success_url: successUrl,
    cancel_url: cancelUrl,
  };
}
