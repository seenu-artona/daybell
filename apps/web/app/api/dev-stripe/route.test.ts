import { afterEach, describe, expect, it, vi } from "vitest";

// The fake Stripe's controls (ADR 0020; security review M2): the route doesn't exist (404) on Vercel, with the real
// driver, or with no driver at all; it answers 404 before anyone is signed in or anything is sent to the webhook, so
// no owner can mark their own account Active or forge payouts there.
vi.mock("server-only", () => ({}));
const { scope, webhook } = vi.hoisted(() => ({ scope: vi.fn(), webhook: vi.fn() }));
vi.mock("@/lib/studio", async (original) => ({
  ...(await original<typeof import("@/lib/studio")>()),
  studioScope: () => scope(),
}));
vi.mock("@/lib/stripe-webhook", () => ({ handleStripeWebhook: webhook }));

const TEST_KEY = ["sk", "test", "x".repeat(24)].join("_");

const post = async () =>
  (await import("./route")).POST(
    new Request("http://localhost/api/dev-stripe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "finish" }),
    }),
  );

afterEach(() => {
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("POST /api/dev-stripe", () => {
  it.each([
    ["on Vercel, even if STRIPE_DRIVER says fake", { VERCEL: "1", STRIPE_DRIVER: "fake" }],
    ["with the real driver", { STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY }],
    ["with no driver set", { STRIPE_DRIVER: "" }],
  ])("doesn't exist %s: 404 before sign-in or the webhook", async (_name, env) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await post();
    expect(res.status).toBe(404);
    expect(scope).not.toHaveBeenCalled();
    expect(webhook).not.toHaveBeenCalled();
    errors.mockRestore();
  });

  it("exists with the fake driver off Vercel (it then asks who is signed in)", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_DRIVER", "fake");
    const { ApiError } = await import("@daybell/api");
    scope.mockRejectedValue(new ApiError("not_signed_in", "Please sign in."));
    expect((await post()).status).toBe(401);
    expect(scope).toHaveBeenCalledTimes(1);
  });
});
