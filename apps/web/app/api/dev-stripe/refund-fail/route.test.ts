import { afterEach, describe, expect, it, vi } from "vitest";

// The fake Stripe's failed refund (ADR 0024): like the other fake controls, the route doesn't exist (404) on Vercel,
// with the real driver or with no driver, before its body is read or anything is sent to the webhook.
vi.mock("server-only", () => ({}));
const { webhook } = vi.hoisted(() => ({ webhook: vi.fn() }));
vi.mock("@/lib/stripe-webhook", () => ({ handleStripeWebhook: webhook }));

const TEST_KEY = ["sk", "test", "x".repeat(24)].join("_");
const post = async (body: unknown) =>
  (await import("./route")).POST(
    new Request("http://localhost/api/dev-stripe/refund-fail", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/dev-stripe/refund-fail", () => {
  it.each([
    ["on Vercel, even if STRIPE_DRIVER says fake", { VERCEL: "1", STRIPE_DRIVER: "fake" }],
    ["with the real driver", { STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY }],
    ["with no driver set", { STRIPE_DRIVER: "" }],
  ])("doesn't exist %s", async (_name, env) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await post({ refund: "re_fakeA" })).status).toBe(404);
    expect(webhook).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("with the fake driver, knows only the fake's own refunds", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_DRIVER", "fake");
    expect((await post({ refund: "re_fakeNOPE" })).status).toBe(404);
    expect((await post({ refund: "re_live_real" })).status).toBe(400);
    expect(webhook).not.toHaveBeenCalled();
  });
});
