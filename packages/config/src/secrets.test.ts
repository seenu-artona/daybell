import { describe, expect, it } from "vitest";
import { accessCodeKeys } from "./secrets";

const key = (fill: number) => btoa(String.fromCharCode(...new Uint8Array(32).fill(fill)));

describe("accessCodeKeys", () => {
  it("reads two different 32-byte base64 keys", () => {
    const keys = accessCodeKeys({
      ACCESS_CODE_HMAC_KEY: key(1),
      ACCESS_CODE_ENCRYPTION_KEY: key(2),
    });
    expect(keys.hmacKey).toHaveLength(32);
    expect(keys.encryptionKey[0]).toBe(2);
  });

  it("refuses missing, short, long or garbled keys without repeating them", () => {
    const short = btoa("secret-value-too-short");
    const long = btoa("x".repeat(48));
    for (const bad of [undefined, "", short, long, "not*base64!", `${key(1)}junk`]) {
      let message = "";
      try {
        accessCodeKeys({ ACCESS_CODE_HMAC_KEY: bad, ACCESS_CODE_ENCRYPTION_KEY: key(2) });
      } catch (err) {
        message = (err as Error).message;
      }
      expect(message).toMatch(/^ACCESS_CODE_HMAC_KEY must be 32 random bytes/);
      if (bad) expect(message).not.toContain(bad);
    }
    expect(() =>
      accessCodeKeys({ ACCESS_CODE_HMAC_KEY: key(1), ACCESS_CODE_ENCRYPTION_KEY: short }),
    ).toThrow(/^ACCESS_CODE_ENCRYPTION_KEY must be 32 random bytes/);
  });

  it("refuses the same key for both jobs", () => {
    expect(() =>
      accessCodeKeys({ ACCESS_CODE_HMAC_KEY: key(7), ACCESS_CODE_ENCRYPTION_KEY: key(7) }),
    ).toThrow(/must be different/);
  });
});
