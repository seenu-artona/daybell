import { afterEach, describe, expect, it, vi } from "vitest";

// The fake Stripe's onboarding page (ADR 0020; security review M2): notFound() on Vercel, with the real driver, or with
// no driver at all; it renders only with the fake driver off Vercel.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("./fake-stripe", () => ({ FakeStripe: () => null }));

const TEST_KEY = ["sk", "test", "x".repeat(24)].join("_");
const open = async () => (await import("./page")).default({ searchParams: Promise.resolve({}) });

afterEach(() => vi.unstubAllEnvs());

describe("/dev/stripe-onboarding", () => {
  it.each([
    ["on Vercel, even if STRIPE_DRIVER says fake", { VERCEL: "1", STRIPE_DRIVER: "fake" }],
    ["with the real driver", { STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY }],
    ["with no driver set", { STRIPE_DRIVER: "" }],
  ])("is not found %s", async (_name, env) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await expect(open()).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders with the fake driver off Vercel", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_DRIVER", "fake");
    await expect(open()).resolves.toBeTruthy();
  });
});
