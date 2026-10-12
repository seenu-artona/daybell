import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { supabaseSecretKey, supabaseSecretKeyName } = await import("./server");

describe("supabaseSecretKey", () => {
  it("reads each region's own secret key, trimmed", () => {
    const raw = { us: " sb_secret_us ", ca: "sb_secret_ca" };
    expect(supabaseSecretKey("us", raw)).toBe("sb_secret_us");
    expect(supabaseSecretKey("ca", raw)).toBe("sb_secret_ca");
  });

  it("refuses a missing key, naming the variable and never a value", () => {
    expect(() => supabaseSecretKey("ca", { us: "sb_secret_us", ca: undefined })).toThrow(
      /^SUPABASE_SECRET_KEY_CA is not set$/,
    );
    expect(() => supabaseSecretKey("us", { us: "  ", ca: "sb_secret_ca" })).toThrow(
      /^SUPABASE_SECRET_KEY_US is not set$/,
    );
  });

  it("is never a public (browser) setting", () => {
    for (const region of ["us", "ca"] as const)
      expect(supabaseSecretKeyName(region)).not.toMatch(/^NEXT_PUBLIC_/);
  });
});

const { stripeSettings, stripeWebhookSecrets } = await import("./server");

describe("stripeSettings (ADR 0020)", () => {
  // Key-shaped values are built at run time, so secret scanners (GitHub push protection, gitleaks) never see one.
  const key = (prefix: string, mode: string) => [prefix, mode, "x".repeat(24)].join("_");
  const TEST_KEY = key("sk", "test");
  const LIVE_KEY = key("sk", "live");

  it("is null when payouts aren't set up in this environment", () => {
    expect(stripeSettings({})).toBeNull();
    expect(stripeSettings({ STRIPE_DRIVER: " " })).toBeNull();
  });

  it("allows the fake driver off Vercel only", () => {
    expect(stripeSettings({ STRIPE_DRIVER: "fake" })).toEqual({ driver: "fake" });
    for (const env of [{ VERCEL: "1" }, { VERCEL_ENV: "preview" }, { VERCEL_ENV: "production" }])
      expect(() => stripeSettings({ STRIPE_DRIVER: "fake", ...env })).toThrow(
        /^STRIPE_DRIVER=fake is not allowed on Vercel$/,
      );
  });

  it("reads a test key, and refuses a live key outside production", () => {
    expect(stripeSettings({ STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: TEST_KEY })).toEqual({
      driver: "stripe",
      secretKey: TEST_KEY,
      livemode: false,
    });
    expect(
      stripeSettings({ STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: key("rk", "test") }),
    ).toMatchObject({ livemode: false });
    for (const VERCEL_ENV of [undefined, "preview", "development"])
      expect(() =>
        stripeSettings({ STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: LIVE_KEY, VERCEL_ENV }),
      ).toThrow(/^STRIPE_SECRET_KEY must be a test-mode key outside production$/);
    expect(
      stripeSettings({
        STRIPE_DRIVER: "stripe",
        STRIPE_SECRET_KEY: LIVE_KEY,
        VERCEL_ENV: "production",
      }),
    ).toMatchObject({ livemode: true });
  });

  it("names the variable, never the value", () => {
    expect(() => stripeSettings({ STRIPE_DRIVER: "stripe" })).toThrow(
      /^STRIPE_SECRET_KEY is not set$/,
    );
    const bad = key("pk", "test");
    try {
      stripeSettings({ STRIPE_DRIVER: "stripe", STRIPE_SECRET_KEY: bad });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "STRIPE_SECRET_KEY must be a Stripe secret or restricted key",
      );
      expect((err as Error).message).not.toContain(bad);
    }
    expect(() => stripeSettings({ STRIPE_DRIVER: "paypal" })).toThrow(
      /^STRIPE_DRIVER must be stripe or fake$/,
    );
  });
});

describe("stripeWebhookSecrets (ADR 0020)", () => {
  const ONE = ["whsec", "a".repeat(24)].join("_");
  const TWO = ["whsec", "z".repeat(24)].join("_");

  it("reads one to four signing secrets (snapshot and thin destinations, each mid-rotation)", () => {
    expect(stripeWebhookSecrets({ STRIPE_WEBHOOK_SECRET: ONE })).toEqual([ONE]);
    expect(stripeWebhookSecrets({ STRIPE_WEBHOOK_SECRET: ` ${ONE} , ${TWO} ` })).toEqual([
      ONE,
      TWO,
    ]);
    expect(stripeWebhookSecrets({ STRIPE_WEBHOOK_SECRET: [ONE, TWO, ONE, TWO].join(",") })).toEqual(
      [ONE, TWO, ONE, TWO],
    );
  });

  it("refuses anything else, by name only", () => {
    expect(() => stripeWebhookSecrets({})).toThrow(/^STRIPE_WEBHOOK_SECRET is not set$/);
    for (const value of [
      "secret",
      [ONE, TWO, ONE, TWO, ONE].join(","),
      `${ONE},secret`,
      ["whsec", "short"].join("_"),
    ])
      expect(() => stripeWebhookSecrets({ STRIPE_WEBHOOK_SECRET: value })).toThrow(
        /^STRIPE_WEBHOOK_SECRET must be one to four whsec_ signing secrets$/,
      );
  });
});
