import Stripe from "stripe";
import { afterEach, describe, expect, it, vi } from "vitest";

// Daybell's Stripe entry points (ADR 0020): a deployment with no STRIPE_DRIVER (PR previews) says payouts aren't set
// up here, with its own form code, not "not available in this region" (code review N12); Stripe links must be
// Stripe's own Connect pages, or this deployment's fake pages with the fake driver (security review N5).
vi.mock("server-only", () => ({}));
const { assertStripeLink, payments, signStripeBody, verifyStripeWebhook } = await import("./index");

afterEach(() => vi.unstubAllEnvs());

describe("payments()", () => {
  it("refuses with payouts.notConfigured where Stripe isn't set up", () => {
    vi.stubEnv("STRIPE_DRIVER", "");
    try {
      payments();
      expect.unreachable();
    } catch (err) {
      expect(err).toMatchObject({
        code: "region_unavailable",
        fields: { form: "payouts.notConfigured" },
        message: "Payouts aren't set up in this environment.",
      });
    }
  });
});

describe("assertStripeLink", () => {
  it("lets Stripe's Connect pages through for the real driver, and nothing else", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(assertStripeLink("https://connect.stripe.com/setup/e/x", "stripe")).toBe(
      "https://connect.stripe.com/setup/e/x",
    );
    for (const url of [
      "http://connect.stripe.com/setup",
      "https://connect.stripe.com.evil.example/",
      "https://evil.example/https://connect.stripe.com/",
      "javascript:alert(1)",
    ])
      expect(() => assertStripeLink(url, "stripe")).toThrow(
        expect.objectContaining({ code: "internal" }),
      );
    expect(JSON.stringify(errors.mock.calls)).not.toContain("evil");
    errors.mockRestore();
  });

  it("lets only this deployment's own pages through for the fake driver", () => {
    vi.stubEnv("SITE_URL", "https://dev.daybell.test");
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(assertStripeLink("https://dev.daybell.test/dev/stripe-onboarding", "fake")).toBe(
      "https://dev.daybell.test/dev/stripe-onboarding",
    );
    expect(() => assertStripeLink("https://dev.daybell.test.evil.example/", "fake")).toThrow();
    expect(() => assertStripeLink("https://connect.stripe.com/setup", "fake")).toThrow();
    errors.mockRestore();
  });
});

describe("verifyStripeWebhook (ADR 0020 amendment)", () => {
  // Built at run time so secret scanners never see a signing-secret-shaped literal.
  const SNAPSHOT = ["whsec", "snapshot".repeat(3)].join("_");
  const THIN = ["whsec", "thinpayload".repeat(3)].join("_");
  const snapshot = JSON.stringify({ id: "evt_1", object: "event", type: "account.updated" });
  const thin = JSON.stringify({
    id: "evt_test_1",
    object: "v2.core.event",
    type: "v2.core.account.updated",
  });

  it("takes snapshot and thin events signed with any of the destinations' secrets", () => {
    expect(
      verifyStripeWebhook(snapshot, signStripeBody(snapshot, SNAPSHOT), [SNAPSHOT, THIN]),
    ).toEqual({
      payload: "snapshot",
      event: JSON.parse(snapshot),
    });
    expect(verifyStripeWebhook(thin, signStripeBody(thin, THIN), [SNAPSHOT, THIN])).toEqual({
      payload: "thin",
      event: JSON.parse(thin),
    });
  });

  it("refuses a missing or wrong signature, a changed body, an old timestamp and other objects", () => {
    expect(verifyStripeWebhook(thin, null, [THIN])).toBeNull();
    expect(verifyStripeWebhook(thin, signStripeBody(thin, SNAPSHOT), [THIN])).toBeNull();
    expect(
      verifyStripeWebhook(thin.replace("updated", "closed"), signStripeBody(thin, THIN), [THIN]),
    ).toBeNull();
    const old = Math.floor(Date.now() / 1000) - 301;
    const stale = Stripe.webhooks.generateTestHeaderString({
      payload: thin,
      secret: THIN,
      timestamp: old,
    });
    expect(verifyStripeWebhook(thin, stale, [THIN])).toBeNull();
    for (const body of [JSON.stringify({ id: "x", object: "account" }), "not json", "null"])
      expect(verifyStripeWebhook(body, signStripeBody(body, THIN), [THIN])).toBeNull();
    expect(verifyStripeWebhook(thin, signStripeBody(thin, THIN), [])).toBeNull();
  });
});
