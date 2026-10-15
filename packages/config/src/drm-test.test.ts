import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The DRM test page's settings (D158; ADR 0032). Every key here is made at run time: none is ever written in a file.
vi.mock("server-only", () => ({}));
const { drmTestPageEnabled, drmTestSettings } = await import("./server");

const COM_KEY = randomBytes(32);
const CONTENT_KEY = randomBytes(16);
const good = () => ({
  AXINOM_COM_KEY_ID: randomUUID(),
  AXINOM_COM_KEY: COM_KEY.toString("base64"),
  AXINOM_LICENSE_PREFIX: "tenant-1",
  DRM_TEST_KEY_ID: randomUUID(),
  DRM_TEST_CONTENT_KEY: CONTENT_KEY.toString("hex"),
});

describe("drmTestPageEnabled", () => {
  it("is on only for the exact word true", () => {
    expect(drmTestPageEnabled({ DRM_TEST_PAGE_ENABLED: "true" })).toBe(true);
    expect(drmTestPageEnabled({ DRM_TEST_PAGE_ENABLED: " true " })).toBe(true);
    for (const value of [undefined, "", "1", "yes", "TRUE", "false"])
      expect(drmTestPageEnabled({ DRM_TEST_PAGE_ENABLED: value })).toBe(false);
  });
});

describe("drmTestSettings", () => {
  it("reads every setting, keys as bytes, GUIDs as lowercase with dashes", () => {
    const env = good();
    const dashless = env.DRM_TEST_KEY_ID.replaceAll("-", "").toUpperCase();
    const settings = drmTestSettings({ ...env, DRM_TEST_KEY_ID: dashless });
    expect(settings.comKeyId).toBe(env.AXINOM_COM_KEY_ID);
    expect(Buffer.from(settings.comKey).equals(COM_KEY)).toBe(true);
    expect(settings.licensePrefix).toBe("tenant-1");
    expect(settings.keyId).toBe(env.DRM_TEST_KEY_ID);
    expect(Buffer.from(settings.contentKey).equals(CONTENT_KEY)).toBe(true);
    expect(settings.fairplayCertificateUrl).toBeNull();
  });

  it("takes an optional https FairPlay certificate address", () => {
    const url = "https://certs.example.test/fairplay.der";
    expect(
      drmTestSettings({ ...good(), AXINOM_FAIRPLAY_CERT_URL: url }).fairplayCertificateUrl,
    ).toBe(url);
    expect(() =>
      drmTestSettings({ ...good(), AXINOM_FAIRPLAY_CERT_URL: "http://certs.example.test/x" }),
    ).toThrow(/^AXINOM_FAIRPLAY_CERT_URL must be an https:\/\/ address$/);
  });

  it.each([
    ["AXINOM_COM_KEY_ID", "not-a-guid", /^AXINOM_COM_KEY_ID must be a GUID$/],
    ["AXINOM_COM_KEY", randomBytes(16).toString("base64"), /^AXINOM_COM_KEY must be 32 bytes/],
    ["AXINOM_COM_KEY", "%%%", /^AXINOM_COM_KEY must be 32 bytes/],
    ["AXINOM_LICENSE_PREFIX", "a.b/c", /^AXINOM_LICENSE_PREFIX must be the tenant part/],
    ["DRM_TEST_KEY_ID", "1234", /^DRM_TEST_KEY_ID must be a GUID$/],
    ["DRM_TEST_CONTENT_KEY", "abcd", /^DRM_TEST_CONTENT_KEY must be 16 bytes as 32 hex digits$/],
  ])("refuses a bad %s, naming it and never the value", (name, value, message) => {
    try {
      drmTestSettings({ ...good(), [name]: value });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(message);
      expect((err as Error).message).not.toContain(value);
    }
  });

  it.each([
    "AXINOM_COM_KEY_ID",
    "AXINOM_COM_KEY",
    "AXINOM_LICENSE_PREFIX",
    "DRM_TEST_KEY_ID",
    "DRM_TEST_CONTENT_KEY",
  ])("names %s when it is missing", (name) => {
    expect(() => drmTestSettings({ ...good(), [name]: " " })).toThrow(
      new RegExp(`^${name} is not set$`),
    );
  });

  it("refuses a content key equal to its key ID", () => {
    const env = good();
    expect(() =>
      drmTestSettings({ ...env, DRM_TEST_CONTENT_KEY: env.DRM_TEST_KEY_ID.replaceAll("-", "") }),
    ).toThrow(/^DRM_TEST_CONTENT_KEY must be different from DRM_TEST_KEY_ID$/);
  });
});
