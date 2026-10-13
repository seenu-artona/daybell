import { afterEach, describe, expect, it, vi } from "vitest";

// The fake Stripe's checkout controls (ADR 0023): like /api/dev-stripe, the route doesn't exist (404) on Vercel, with
// the real driver or with no driver, before its body is read or anything is sent to the webhook.
vi.mock("server-only", () => ({}));
const { webhook } = vi.hoisted(() => ({ webhook: vi.fn() }));
vi.mock("@/lib/stripe-webhook", () => ({ handleStripeWebhook: webhook }));

const TEST_KEY = ["sk", "test", "x".repeat(24)].join("_");
const post = async (body: unknown) =>
  (await import("./route")).POST(
    new Request("http://localhost/api/dev-stripe/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/dev-stripe/checkout", () => {
  it.each([
    ["on Vercel, even if STRIPE_DRIVER says fake", { VERCEL: "1", STRIPE_DRIVER: "fake" }],
    ["with the real driver", { STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY }],
    ["with no driver set", { STRIPE_DRIVER: "" }],
  ])("doesn't exist %s", async (_name, env) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post({ action: "cancel", session: "cs_test_fakeA" });
    expect(res.status).toBe(404);
    expect(webhook).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("with the fake driver, knows only the fake's own checkouts", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_DRIVER", "fake");
    expect((await post({ action: "cancel", session: "cs_test_fakeNOPE" })).status).toBe(404);
    expect((await post({ action: "cancel", session: "cs_live_real" })).status).toBe(400);
    expect(webhook).not.toHaveBeenCalled();
  });
});
