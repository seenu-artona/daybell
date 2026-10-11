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
