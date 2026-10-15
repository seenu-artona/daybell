import { createDecipheriv, createHmac, randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// License tokens for the DRM test page (D158; ADR 0032). Keys are made at run time; none is ever written in a file.
vi.mock("server-only", () => ({}));
const { DRM_TOKEN_TTL_SECONDS, encryptContentKey, guidBytes, licenseToken, licenseUrls } =
  await import("./drm-test");

const settings = () => ({
  comKeyId: randomUUID(),
  comKey: new Uint8Array(randomBytes(32)),
  keyId: randomUUID(),
  contentKey: new Uint8Array(randomBytes(16)),
});

function decode(token: string) {
  const [header, payload, signature] = token.split(".");
  return {
    header: JSON.parse(Buffer.from(header as string, "base64url").toString()),
    payload: JSON.parse(Buffer.from(payload as string, "base64url").toString()),
    signed: `${header}.${payload}`,
    signature: signature as string,
  };
}

describe("guidBytes", () => {
  it("keeps the GUID's written (big-endian) byte order", () => {
    expect(guidBytes("00112233-4455-6677-8899-aabbccddeeff").toString("hex")).toBe(
      "00112233445566778899aabbccddeeff",
    );
    expect(() => guidBytes("nope")).toThrow();
  });
});

describe("encryptContentKey", () => {
  it("decrypts back to the content key with the communication key and the key ID as IV", () => {
    const s = settings();
    const wrapped = Buffer.from(encryptContentKey(s.contentKey, s.comKey, s.keyId), "base64");
    expect(wrapped.length).toBe(16);
    expect(wrapped.equals(Buffer.from(s.contentKey))).toBe(false);
    const decipher = createDecipheriv("aes-256-cbc", s.comKey, guidBytes(s.keyId));
    decipher.setAutoPadding(false);
    const back = Buffer.concat([decipher.update(wrapped), decipher.final()]);
    expect(back.equals(Buffer.from(s.contentKey))).toBe(true);
  });

  it("refuses keys of the wrong length", () => {
    const s = settings();
    expect(() => encryptContentKey(new Uint8Array(15), s.comKey, s.keyId)).toThrow();
    expect(() => encryptContentKey(s.contentKey, new Uint8Array(16), s.keyId)).toThrow();
  });
});

describe("licenseToken", () => {
  it("is an HS256 JWT whose signature verifies with the communication key's bytes", () => {
    const s = settings();
    const { token } = licenseToken(s);
    const { header, signed, signature } = decode(token);
    expect(header).toEqual({ alg: "HS256", typ: "JWT" });
    expect(createHmac("sha256", s.comKey).update(signed).digest("base64url")).toBe(signature);
    // Not with any other key, and not with the key's base64 text.
    expect(createHmac("sha256", randomBytes(32)).update(signed).digest("base64url")).not.toBe(
      signature,
    );
    expect(
      createHmac("sha256", Buffer.from(s.comKey).toString("base64"))
        .update(signed)
        .digest("base64url"),
    ).not.toBe(signature);
  });

  it("carries one inline key under a hardware-only policy", () => {
    const s = settings();
    const { payload } = decode(licenseToken(s).token);
    expect(payload).toMatchObject({
      version: 1,
      com_key_id: s.comKeyId,
      message: {
        version: 2,
        type: "entitlement_message",
        license: { allow_persistence: false },
        content_keys_source: { inline: [{ id: s.keyId, usage_policy: "Policy A" }] },
        content_key_usage_policies: [
          {
            name: "Policy A",
            widevine: { device_security_level: "HW_SECURE_ALL" },
            playready: { min_device_security_level: 3000 },
            fairplay: { hdcp: "TYPE1", allow_airplay: false, allow_av_adapter: false },
          },
        ],
      },
    });
    expect(payload.message.content_keys_source.inline).toHaveLength(1);
    const wrapped = payload.message.content_keys_source.inline[0].encrypted_key;
    expect(wrapped).toBe(encryptContentKey(s.contentKey, s.comKey, s.keyId));
  });

  it("is good for at most 60 seconds", () => {
    const now = new Date("2026-10-14T12:00:00.750Z");
    const { token, expiresAt } = licenseToken(settings(), now);
    const { payload } = decode(token);
    expect(DRM_TOKEN_TTL_SECONDS).toBeLessThanOrEqual(60);
    expect(payload.begin_date).toBe("2026-10-14T12:00:00.000Z");
    expect(payload.expiration_date).toBe("2026-10-14T12:01:00.000Z");
    expect(expiresAt).toBe(payload.expiration_date);
    expect(Date.parse(expiresAt) - now.getTime()).toBeLessThanOrEqual(60_000);
  });

  it("never holds a key in the clear", () => {
    const s = settings();
    const text = Buffer.from(licenseToken(s).token.split(".")[1] as string, "base64url").toString();
    for (const key of [s.contentKey, s.comKey]) {
      expect(text).not.toContain(Buffer.from(key).toString("hex"));
      expect(text).not.toContain(Buffer.from(key).toString("base64"));
    }
  });
});

describe("licenseUrls", () => {
  it("names the tenant's Axinom servers, FairPlay only when it is set up", () => {
    expect(licenseUrls("t1", false)).toEqual({
      widevine: "https://t1.drm-widevine-licensing.axprod.net/AcquireLicense",
      playready: "https://t1.drm-playready-licensing.axprod.net/AcquireLicense",
      fairplay: null,
    });
    expect(licenseUrls("t1", true).fairplay).toBe(
      "https://t1.drm-fairplay-licensing.axprod.net/AcquireLicense",
    );
  });
});
