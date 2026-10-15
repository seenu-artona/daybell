import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

// The shop's DRM settings (D158; ADR 0034). Every key here is made at run time: none is ever written in a file.
vi.mock("server-only", () => ({}));
const { awsDrmRoleArn, drmKmsKeyArn, shopDrmSettings } = await import("./server");

const COM_KEY = randomBytes(32);
/** A stand-in for a DER certificate: a SEQUENCE byte and random bytes. */
const CERT = Buffer.concat([Buffer.from([0x30, 0x82]), randomBytes(900)]);
const good = () => ({
  SHOP_DRM_COM_KEY_ID: randomUUID(),
  SHOP_DRM_COM_KEY: COM_KEY.toString("base64"),
  SHOP_DRM_LICENSE_PREFIX: "Daybell-Shop",
});

describe("shopDrmSettings", () => {
  it("is null when the shop's DRM isn't set up here (the shop keeps the WebP)", () => {
    expect(shopDrmSettings({})).toBeNull();
    expect(shopDrmSettings({ SHOP_DRM_COM_KEY: " ", SHOP_DRM_FAIRPLAY_CERT: "" })).toBeNull();
  });

  it("reads every setting: keys as bytes, the GUID lower-case with dashes, the prefix lower-case", () => {
    const env = good();
    const settings = shopDrmSettings({
      ...env,
      SHOP_DRM_COM_KEY_ID: env.SHOP_DRM_COM_KEY_ID.replaceAll("-", "").toUpperCase(),
    });
    expect(settings?.comKeyId).toBe(env.SHOP_DRM_COM_KEY_ID);
    expect(Buffer.from(settings?.comKey ?? []).equals(COM_KEY)).toBe(true);
    expect(settings?.licensePrefix).toBe("daybell-shop");
    expect(settings?.fairplayCertificate).toBeNull();
  });

  it("takes an optional FairPlay certificate as base64 DER (C10)", () => {
    const settings = shopDrmSettings({
      ...good(),
      SHOP_DRM_FAIRPLAY_CERT: CERT.toString("base64"),
    });
    expect(Buffer.from(settings?.fairplayCertificate ?? []).equals(CERT)).toBe(true);
  });

  it.each([
    ["SHOP_DRM_COM_KEY_ID", "nope", /^SHOP_DRM_COM_KEY_ID must be a GUID$/],
    ["SHOP_DRM_COM_KEY", randomBytes(16).toString("base64"), /^SHOP_DRM_COM_KEY must be 32 bytes/],
    ["SHOP_DRM_COM_KEY", "%%%%", /^SHOP_DRM_COM_KEY must be 32 bytes/],
    ["SHOP_DRM_LICENSE_PREFIX", "a.b/c", /^SHOP_DRM_LICENSE_PREFIX must be the tenant part/],
    ["SHOP_DRM_FAIRPLAY_CERT", "not base64!", /^SHOP_DRM_FAIRPLAY_CERT must be/],
    ["SHOP_DRM_FAIRPLAY_CERT", randomBytes(200).fill(1).toString("base64"), /^SHOP_DRM_FAIRPLAY/],
  ])("refuses a bad %s, naming it and never the value", (name, value, message) => {
    try {
      shopDrmSettings({ ...good(), [name]: value });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(message);
      expect((err as Error).message).not.toContain(value);
    }
  });

  it.each(["SHOP_DRM_COM_KEY_ID", "SHOP_DRM_COM_KEY", "SHOP_DRM_LICENSE_PREFIX"])(
    "refuses a partial setup: %s missing",
    (name) => {
      expect(() => shopDrmSettings({ ...good(), [name]: "" })).toThrow(`${name} is not set`);
    },
  );

  it("refuses the DRM test page's communication key (ADR 0032: a separate key for testing)", () => {
    const env = good();
    expect(() => shopDrmSettings({ ...env, AXINOM_COM_KEY: env.SHOP_DRM_COM_KEY })).toThrow(
      /^SHOP_DRM_COM_KEY must be different from AXINOM_COM_KEY$/,
    );
    expect(
      shopDrmSettings({ ...env, AXINOM_COM_KEY: randomBytes(32).toString("base64") }),
    ).not.toBeNull();
  });
});

const S3 = {
  STORAGE_DRIVER: "s3",
  AWS_REGION: "ca-central-1",
  PHOTO_BUCKET_CA: "daybell-staging-ca-photos",
  PHOTO_QUEUE_URL_CA: "https://sqs.ca-central-1.amazonaws.com/123456789012/q",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/daybell-staging-web",
  AWS_DOWNLOAD_ROLE_ARN: "arn:aws:iam::123456789012:role/daybell-staging-downloads",
};

describe("awsDrmRoleArn (B4)", () => {
  const ROLE = "arn:aws:iam::123456789012:role/daybell-staging-drm";
  it("reads the DRM route's own role for S3, null locally and where photos aren't stored", () => {
    expect(awsDrmRoleArn("ca", { ...S3, AWS_DRM_ROLE_ARN: ROLE })).toBe(ROLE);
    expect(awsDrmRoleArn("us", { ...S3, AWS_DRM_ROLE_ARN: ROLE })).toBeNull();
    expect(awsDrmRoleArn("ca", { STORAGE_DRIVER: "local" })).toBeNull();
  });

  it("must be set, an IAM role, and neither the web app's nor the downloads' role", () => {
    expect(() => awsDrmRoleArn("ca", S3)).toThrow(/^AWS_DRM_ROLE_ARN is not set$/);
    expect(() => awsDrmRoleArn("ca", { ...S3, AWS_DRM_ROLE_ARN: "role" })).toThrow(
      /^AWS_DRM_ROLE_ARN must be an IAM role ARN$/,
    );
    expect(() => awsDrmRoleArn("ca", { ...S3, AWS_DRM_ROLE_ARN: S3.AWS_ROLE_ARN })).toThrow(
      /different role from AWS_ROLE_ARN$/,
    );
    expect(() =>
      awsDrmRoleArn("ca", { ...S3, AWS_DRM_ROLE_ARN: S3.AWS_DOWNLOAD_ROLE_ARN }),
    ).toThrow(/different role from AWS_DOWNLOAD_ROLE_ARN$/);
  });
});

describe("drmKmsKeyArn (D113)", () => {
  const KEY = "arn:aws:kms:ca-central-1:123456789012:key/1234abcd-12ab-34cd-56ef-1234567890ab";
  const ALIAS = "arn:aws:kms:ca-central-1:123456789012:alias/daybell-staging-ca-drm";
  it("reads a key ARN in ca-central-1 (never an alias: review L3); unset means DRM packaging is off here", () => {
    expect(drmKmsKeyArn("ca", { ...S3, DRM_KMS_KEY_ARN_CA: KEY })).toBe(KEY);
    expect(() => drmKmsKeyArn("ca", { ...S3, DRM_KMS_KEY_ARN_CA: ALIAS })).toThrow(
      /^DRM_KMS_KEY_ARN_CA must be a KMS key ARN in ca-central-1$/,
    );
    expect(drmKmsKeyArn("ca", S3)).toBeNull();
    expect(drmKmsKeyArn("ca", { STORAGE_DRIVER: "local", DRM_KMS_KEY_ARN_CA: KEY })).toBeNull();
    expect(drmKmsKeyArn("us", { ...S3, DRM_KMS_KEY_ARN_CA: KEY })).toBeNull();
  });

  it("refuses a key in another region, naming the variable only", () => {
    const usKey = KEY.replace("ca-central-1", "us-east-1");
    try {
      drmKmsKeyArn("ca", { ...S3, DRM_KMS_KEY_ARN_CA: usKey });
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toBe(
        "DRM_KMS_KEY_ARN_CA must be a KMS key ARN in ca-central-1",
      );
    }
  });
});
