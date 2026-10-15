import { describe, expect, it } from "vitest";
import {
  type CheckoutOrder,
  checkoutExpiresAt,
  checkoutParams,
  checkoutReturnUrls,
} from "./stripe-params";

// Stripe's hosted checkout for an order (ADR 0023 §4; D97, D106, D104, D24, D59): the parameters Daybell sends, pinned.
// The function is typed with stripe-node 22.6.2's own SessionCreateParams, so the compiler checks every field name.

const ORDER: CheckoutOrder = {
  orderId: "0c0c0c0c-0c0c-4c0c-8c0c-0c0c0c0c0c0c",
  studioId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  region: "ca",
  galleryId: "0123456789abcdef0123456789abcdef",
  studioName: "Maple Lane Photography",
  currency: "CAD",
  destination: "acct_A1",
  lines: [
    { kind: "package", name: "Package A", unitPriceCents: 8500, quantity: 1 },
    { kind: "print", name: "4×6 print", unitPriceCents: 1300, quantity: 2 },
    { kind: "digital_single", name: "Digital download", unitPriceCents: 3300, quantity: 1 },
  ],
  shippingMethod: "home",
  shippingCents: 1195,
  taxEnabled: true,
  daybellFeeCents: 453,
  createdAt: 1_791_000_000,
};
const TEXT = {
  processedBy: "Payments processed by Silverback for Maple Lane Photography",
  homeShipping: "Home delivery",
};
const SITE = "https://daybell.test";

describe("checkoutParams", () => {
  const params = checkoutParams(ORDER, TEXT, SITE);

  it("is a destination charge on behalf of the studio, with Daybell's fee as the application fee (D106, D59)", () => {
    expect(params.mode).toBe("payment");
    expect(params.ui_mode).toBe("hosted_page");
    expect(params.payment_intent_data).toMatchObject({
      on_behalf_of: "acct_A1",
      transfer_data: { destination: "acct_A1" },
      application_fee_amount: 453,
    });
  });

  it("prices each line before tax from the order, never from the browser (ADR 0019)", () => {
    expect(params.line_items).toEqual([
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: 8500,
          tax_behavior: "exclusive",
          product_data: { name: "Package A", tax_code: "txcd_99999999" },
        },
      },
      {
        quantity: 2,
        price_data: {
          currency: "cad",
          unit_amount: 1300,
          tax_behavior: "exclusive",
          product_data: { name: "4×6 print", tax_code: "txcd_99999999" },
        },
      },
      {
        quantity: 1,
        price_data: {
          currency: "cad",
          unit_amount: 3300,
          tax_behavior: "exclusive",
          product_data: { name: "Digital download", tax_code: "txcd_10000000" },
        },
      },
    ]);
  });

  it("uses Stripe Tax with the studio liable only when it has a registration (answer 2)", () => {
    expect(params.automatic_tax).toEqual({
      enabled: true,
      liability: { type: "account", account: "acct_A1" },
    });
    expect(checkoutParams({ ...ORDER, taxEnabled: false }, TEXT, SITE).automatic_tax).toEqual({
      enabled: false,
    });
  });

  it("collects a Canadian address for home delivery only, with its one shipping rate (call 2)", () => {
    expect(params.shipping_address_collection).toEqual({ allowed_countries: ["CA"] });
    expect(params.shipping_options).toEqual([
      {
        shipping_rate_data: {
          type: "fixed_amount",
          display_name: "Home delivery",
          fixed_amount: { amount: 1195, currency: "cad" },
          tax_behavior: "exclusive",
          tax_code: "txcd_92010001",
        },
      },
    ]);
    for (const method of ["school", null] as const) {
      const other = checkoutParams(
        { ...ORDER, shippingMethod: method, shippingCents: 0 },
        TEXT,
        SITE,
      );
      expect(other.shipping_address_collection).toBeUndefined();
      expect(other.shipping_options).toBeUndefined();
    }
  });

  it("takes cards (Apple Pay and Google Pay through them), never Link, and makes no customer (answer 3; D24)", () => {
    expect(params.payment_method_types).toEqual(["card"]);
    expect(params.wallet_options).toEqual({ link: { display: "never" } });
    expect(params.customer_creation).toBe("if_required");
    expect(params).not.toHaveProperty("customer_email");
    expect(params).not.toHaveProperty("customer");
  });

  it("shows the studio first on the statement and the D104 line on the page", () => {
    expect(params.payment_intent_data?.statement_descriptor_suffix).toBe("MAPLE LANE");
    expect(params.payment_intent_data?.description).toBe(TEXT.processedBy);
    expect(params.custom_text).toEqual({ submit: { message: TEXT.processedBy } });
    expect(params.branding_settings).toEqual({
      display_name: "Maple Lane Photography",
      button_color: "#1c1c1e",
    });
    expect(
      checkoutParams({ ...ORDER, studioName: "1234" }, TEXT, SITE).payment_intent_data,
    ).not.toHaveProperty("statement_descriptor_suffix");
  });

  it("carries Daybell's ids only, and comes back to this deployment's own pages", () => {
    const ids = {
      daybell_order_id: ORDER.orderId,
      daybell_studio_id: ORDER.studioId,
      daybell_region: "ca",
    };
    expect(params.metadata).toEqual(ids);
    expect(params.payment_intent_data?.metadata).toEqual(ids);
    expect(params.client_reference_id).toBe(ORDER.orderId);
    expect(params.success_url).toBe(
      `${SITE}/shop/orders/${ORDER.orderId}?gallery=${ORDER.galleryId}`,
    );
    expect(params.cancel_url).toBe(`${SITE}/shop/bag?gallery=${ORDER.galleryId}&checkout=canceled`);
    expect(checkoutReturnUrls(SITE, ORDER.orderId, "a&b").cancelUrl).toContain("gallery=a%26b");
  });

  it("never sends a child's name, a photo, an email or a phone", () => {
    const text = JSON.stringify(params);
    expect(text).not.toMatch(/Ava|Patel|@|photo_|f0000000|phone/i);
    expect(params).not.toHaveProperty("phone_number_collection");
  });

  it("lasts just over Stripe's 30 minutes from the order, so a retried create is the same request", () => {
    expect(params.expires_at).toBe(ORDER.createdAt + 32 * 60);
    expect(checkoutExpiresAt(100)).toBe(100 + 32 * 60);
    // A retry at the end of the database's 45-second reuse window, 30 seconds on its way, is still 30 minutes ahead.
    expect(checkoutExpiresAt(100) - (100 + 45 + 30)).toBeGreaterThanOrEqual(30 * 60);
    expect(checkoutParams(ORDER, TEXT, SITE)).toEqual(params);
  });
});
