import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});

describe("access code keys on the server", () => {
  it("fail as an internal error, logging only that keys are missing", async () => {
    vi.stubEnv("ACCESS_CODE_HMAC_KEY", "short-secret-value");
    vi.stubEnv("ACCESS_CODE_ENCRYPTION_KEY", key(2));
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const { accessCodeCryptoKeys } = await import("./access-codes");
    expect(() => accessCodeCryptoKeys()).toThrow(expect.objectContaining({ code: "internal" }));
    expect(log).toHaveBeenCalledWith("access_code_keys_missing");
    expect(JSON.stringify(log.mock.calls)).not.toContain("short-secret-value");
  });

  it("make codes for the studio's region: hash and copy, never the code itself", async () => {
    vi.stubEnv("ACCESS_CODE_HMAC_KEY", key(1));
    vi.stubEnv("ACCESS_CODE_ENCRYPTION_KEY", key(2));
    const { accessCodeCryptoKeys, newAccessCode } = await import("./access-codes");
    const { decryptAccessCode, accessCodeRegion } = await import("@daybell/core");
    const keys = await accessCodeCryptoKeys();
    expect(await accessCodeCryptoKeys()).toBe(keys);
    const id = crypto.randomUUID();
    const made = await newAccessCode("ca", id, keys);
    expect(made.hash).toMatch(/^[0-9a-f]{64}$/);
    const code = await decryptAccessCode(made.ciphertext, id, keys.encryption);
    expect(accessCodeRegion(code)).toBe("ca");
  });
});
