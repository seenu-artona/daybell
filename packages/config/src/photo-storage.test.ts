import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { cronSecret, photoDownloadRoleArn, photoStorageSettings, photoWorkerSecrets } = await import(
  "./server"
);

const S3 = {
  STORAGE_DRIVER: "s3",
  AWS_REGION: "ca-central-1",
  AWS_ROLE_ARN: "arn:aws:iam::123456789012:role/daybell-staging-vercel",
  PHOTO_BUCKET_CA: "daybell-staging-ca-photos",
  PHOTO_QUEUE_URL_CA: "https://sqs.ca-central-1.amazonaws.com/123456789012/q",
};

describe("photoDownloadRoleArn (ADR 0023, call 10)", () => {
  const ROLE = "arn:aws:iam::123456789012:role/daybell-staging-downloads";
  it("reads the downloads' own role for S3", () => {
    expect(photoDownloadRoleArn("ca", { ...S3, AWS_DOWNLOAD_ROLE_ARN: ROLE })).toBe(ROLE);
  });
  it("is null with the local driver and where there is no storage", () => {
    expect(photoDownloadRoleArn("ca", { STORAGE_DRIVER: "local" })).toBeNull();
    expect(photoDownloadRoleArn("us", { ...S3, AWS_DOWNLOAD_ROLE_ARN: ROLE })).toBeNull();
  });
  it("refuses a missing, malformed or shared role, by name only", () => {
    expect(() => photoDownloadRoleArn("ca", S3)).toThrow(/^AWS_DOWNLOAD_ROLE_ARN is not set$/);
    expect(() => photoDownloadRoleArn("ca", { ...S3, AWS_DOWNLOAD_ROLE_ARN: "role" })).toThrow(
      /^AWS_DOWNLOAD_ROLE_ARN must be an IAM role ARN$/,
    );
    expect(() =>
      photoDownloadRoleArn("ca", { ...S3, AWS_DOWNLOAD_ROLE_ARN: S3.AWS_ROLE_ARN }),
    ).toThrow(/different role/);
  });
});

describe("photoStorageSettings (D53, D113)", () => {
  it("reads Canada's bucket, queue and role", () => {
    expect(photoStorageSettings("ca", S3)).toEqual({
      driver: "s3",
      bucket: "daybell-staging-ca-photos",
      queueUrl: S3.PHOTO_QUEUE_URL_CA,
      roleArn: S3.AWS_ROLE_ARN,
      awsRegion: "ca-central-1",
    });
  });

  it("keeps Canadian photos in Canada: any other AWS region is refused", () => {
    expect(() => photoStorageSettings("ca", { ...S3, AWS_REGION: "us-east-1" })).toThrow(
      /^AWS_REGION must be ca-central-1/,
    );
  });

  it("has no US storage yet", () => {
    expect(photoStorageSettings("us", S3)).toBeNull();
  });

  it("names a missing variable, never a value", () => {
    expect(() => photoStorageSettings("ca", { ...S3, PHOTO_BUCKET_CA: " " })).toThrow(
      /^PHOTO_BUCKET_CA is not set$/,
    );
    expect(() => photoStorageSettings("ca", {})).toThrow(/^STORAGE_DRIVER is not set$/);
    expect(() => photoStorageSettings("ca", { STORAGE_DRIVER: "disk" })).toThrow(
      /^STORAGE_DRIVER must be s3 or local$/,
    );
  });

  it("allows the local driver for development and tests, never in production", () => {
    expect(photoStorageSettings("ca", { STORAGE_DRIVER: "local" })).toEqual({
      driver: "local",
      root: ".storage",
    });
    expect(
      photoStorageSettings("us", { STORAGE_DRIVER: "local", LOCAL_STORAGE_DIR: "/x" }),
    ).toEqual({ driver: "local", root: "/x" });
    expect(() =>
      photoStorageSettings("ca", { STORAGE_DRIVER: "local", VERCEL_ENV: "production" }),
    ).toThrow(/not allowed on Vercel/);
    // Previews and staging too (review S7).
    expect(() =>
      photoStorageSettings("ca", { STORAGE_DRIVER: "local", VERCEL: "1", VERCEL_ENV: "preview" }),
    ).toThrow(/not allowed on Vercel/);
  });
});

describe("photoWorkerSecrets and cronSecret", () => {
  const a = "a".repeat(32);
  const b = "b".repeat(40);
  it("accepts one or two long secrets", () => {
    expect(photoWorkerSecrets({ PHOTO_WORKER_SECRETS: a })).toEqual([a]);
    expect(photoWorkerSecrets({ PHOTO_WORKER_SECRETS: ` ${a} , ${b} ` })).toEqual([a, b]);
  });
  it("refuses short, missing or too many secrets without echoing them", () => {
    for (const value of ["short", "", `${a},${b},${a}`, `${a},short`]) {
      const run = () => photoWorkerSecrets({ PHOTO_WORKER_SECRETS: value });
      expect(run).toThrow();
      try {
        run();
      } catch (e) {
        expect(String(e)).not.toContain(a);
      }
    }
    expect(() => cronSecret({ CRON_SECRET: "short" })).toThrow(/at least 32/);
    expect(cronSecret({ CRON_SECRET: b })).toBe(b);
  });
});
