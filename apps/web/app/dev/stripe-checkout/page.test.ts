import { afterEach, describe, expect, it, vi } from "vitest";

// The fake Stripe's checkout page (ADR 0023): notFound() on Vercel, with the real driver, with no driver, and for a
// checkout the fake didn't make; it renders only for the fake's own checkout off Vercel.
vi.mock("server-only", () => ({}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("./fake-checkout", () => ({ FakeCheckout: () => null }));

const TEST_KEY = ["sk", "test", "x".repeat(24)].join("_");
const open = async (session: string) =>
  (await import("./page")).default({ searchParams: Promise.resolve({ session }) });

afterEach(() => vi.unstubAllEnvs());

describe("/dev/stripe-checkout", () => {
  it.each([
    ["on Vercel, even if STRIPE_DRIVER says fake", { VERCEL: "1", STRIPE_DRIVER: "fake" }],
    ["with the real driver", { STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY }],
    ["with no driver set", { STRIPE_DRIVER: "" }],
  ])("is not found %s", async (_name, env) => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
    await expect(open("cs_test_fakeA")).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("renders the fake's own checkout only", async () => {
    vi.stubEnv("VERCEL", "");
    vi.stubEnv("VERCEL_ENV", "");
    vi.stubEnv("STRIPE_DRIVER", "fake");
    await expect(open("cs_test_fakeNOPE")).rejects.toThrow("NEXT_NOT_FOUND");
    await expect(open("../x")).rejects.toThrow("NEXT_NOT_FOUND");
    const { fakeDriver } = await import("@/lib/stripe/fake-driver");
    const { id } = await fakeDriver().createCheckoutSession(
      { mode: "payment", line_items: [], success_url: "http://localhost/s" },
      "k-page",
    );
    await expect(open(id)).resolves.toBeTruthy();
  });
});
