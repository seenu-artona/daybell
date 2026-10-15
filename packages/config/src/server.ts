import "server-only";
import type { DataRegion } from "./regions";

/**
 * Server-only settings (ADR 0011). Import from "@daybell/config/server", never from code that can reach a browser.
 *
 * SUPABASE_SECRET_KEY_US / SUPABASE_SECRET_KEY_CA: each regional project's secret key (Supabase's "secret" API key,
 * sb_secret_…, or the legacy service_role key). It bypasses row-level security, so the web app uses it only for the
 * database functions that write access codes (add_child, import_roster), after checking the signed-in person's studio
 * and role; the database checks that person's role again. Never NEXT_PUBLIC_*, never logged; read on first use, so
 * builds never need it. Errors name the variable, never the value.
 */
// Written out literally, like the public region settings, so each name is easy to find.
const RAW_SECRET_KEYS: Record<DataRegion, string | undefined> = {
  us: process.env.SUPABASE_SECRET_KEY_US,
  ca: process.env.SUPABASE_SECRET_KEY_CA,
};

export function supabaseSecretKeyName(region: DataRegion): string {
  return `SUPABASE_SECRET_KEY_${region.toUpperCase()}`;
}

/** The secret key for a region's database. Throws (naming the variable only) when it isn't set. */
export function supabaseSecretKey(
  region: DataRegion,
  raw: Record<DataRegion, string | undefined> = RAW_SECRET_KEYS,
): string {
  const value = raw[region]?.trim() ?? "";
  if (!value) throw new Error(`${supabaseSecretKeyName(region)} is not set`);
  return value;
}

// ── Photo storage (Phase 1 step 4; ADR 0016) ─────────────────────────────────────────────────────────────────────

/**
 * Where photos are stored, per data region (D53, D113):
 * - STORAGE_DRIVER: "s3" on Vercel; "local" for development, CI and end-to-end tests (files under LOCAL_STORAGE_DIR,
 *   default `.storage` in the web app). "local" is refused on Vercel.
 * - s3, Canada: PHOTO_BUCKET_CA (the bucket, in ca-central-1), PHOTO_QUEUE_URL_CA (the photo-events queue, for
 *   retries), AWS_ROLE_ARN (the role Vercel's OIDC token assumes) and AWS_REGION, which must be ca-central-1 so
 *   Canadian photos never leave Canada.
 * - The US has no photo storage yet (R2 later): its settings are null, and the API refuses with region_unavailable.
 * Errors name the variable, never a value.
 */
export type PhotoStorageSettings =
  | { driver: "s3"; bucket: string; awsRegion: string; roleArn: string; queueUrl: string }
  | { driver: "local"; root: string };

/** The AWS region each data region's photos live in. */
export const PHOTO_AWS_REGION: Record<DataRegion, string | null> = { ca: "ca-central-1", us: null };

function required(env: Record<string, string | undefined>, name: string): string {
  const value = env[name]?.trim() ?? "";
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

export function photoStorageSettings(
  region: DataRegion,
  env: Record<string, string | undefined> = process.env,
): PhotoStorageSettings | null {
  const driver = required(env, "STORAGE_DRIVER");
  if (driver === "local") {
    // Never on Vercel (production, preview or staging): only on a developer's machine and in CI.
    if (env.VERCEL || env.VERCEL_ENV === "production")
      throw new Error("STORAGE_DRIVER=local is not allowed on Vercel");
    return { driver, root: env.LOCAL_STORAGE_DIR?.trim() || ".storage" };
  }
  if (driver !== "s3") throw new Error("STORAGE_DRIVER must be s3 or local");
  const awsRegion = PHOTO_AWS_REGION[region];
  if (!awsRegion) return null;
  if (required(env, "AWS_REGION") !== awsRegion)
    throw new Error(`AWS_REGION must be ${awsRegion} for this region's photos`);
  const suffix = region.toUpperCase();
  return {
    driver,
    bucket: required(env, `PHOTO_BUCKET_${suffix}`),
    queueUrl: required(env, `PHOTO_QUEUE_URL_${suffix}`),
    roleArn: required(env, "AWS_ROLE_ARN"),
    awsRegion,
  };
}

/**
 * AWS_DOWNLOAD_ROLE_ARN (ADR 0023, call 10): the role only the parent download route assumes (with Vercel's OIDC token,
 * like AWS_ROLE_ARN) to sign links to paid downloads. It may read `*\/download.jpg` and nothing else, so the role
 * that signs everything else still never reads a full-resolution file (ADR 0016). Null with the local driver (its own
 * signed URLs) and for regions without photo storage. Named, never shown, when it is missing.
 */
export function photoDownloadRoleArn(
  region: DataRegion,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const settings = photoStorageSettings(region, env);
  if (settings?.driver !== "s3") return null;
  const value = required(env, "AWS_DOWNLOAD_ROLE_ARN");
  if (!/^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,128}$/.test(value))
    throw new Error("AWS_DOWNLOAD_ROLE_ARN must be an IAM role ARN");
  if (value === settings.roleArn)
    throw new Error("AWS_DOWNLOAD_ROLE_ARN must be a different role from AWS_ROLE_ARN");
  return value;
}

/**
 * PHOTO_WORKER_SECRETS: the secrets the image worker signs its requests with, comma-separated, each at least 32
 * characters (`openssl rand -base64 32`). Two while one is being rotated: the worker's new secret is added here first,
 * then the worker is changed, then the old one is removed.
 */
export function photoWorkerSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const secrets = required(env, "PHOTO_WORKER_SECRETS")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (secrets.length === 0 || secrets.length > 2 || secrets.some((s) => s.length < 32))
    throw new Error("PHOTO_WORKER_SECRETS must be one or two secrets of at least 32 characters");
  return secrets;
}

/** CRON_SECRET: Vercel sends it as a bearer token to cron routes. At least 32 characters. */
export function cronSecret(env: Record<string, string | undefined> = process.env): string {
  const value = required(env, "CRON_SECRET");
  if (value.length < 32) throw new Error("CRON_SECRET must be at least 32 characters");
  return value;
}

// ── Payments: Stripe Connect (Phase 1 step 7; ADR 0020) ──────────────────────────────────────────────────────────────

/**
 * How Daybell talks to Stripe (D106; ADR 0020):
 * - STRIPE_DRIVER: "stripe" (the real API) or "fake" (in-memory, for development, CI and end-to-end tests; refused on
 *   Vercel). Unset means payouts aren't set up in this environment (e.g. PR previews; Claude's call Q13): the payout
 *   screens read the database and say so, and nothing calls Stripe.
 * - STRIPE_SECRET_KEY: the platform's secret or restricted key, stripe driver only. Outside VERCEL_ENV=production it
 *   must be a test-mode key (sk_test_ / rk_test_); a live key there is refused.
 * Read on first use, never at build time and never as NEXT_PUBLIC_*. Errors name the variable, never the value.
 */
export type StripeSettings =
  | { driver: "fake" }
  | { driver: "stripe"; secretKey: string; livemode: boolean };

const STRIPE_KEY = /^(sk|rk)_(test|live)_[A-Za-z0-9]{10,}$/;

export function stripeSettings(
  env: Record<string, string | undefined> = process.env,
): StripeSettings | null {
  const driver = env.STRIPE_DRIVER?.trim() ?? "";
  if (!driver) return null;
  if (driver === "fake") {
    // Never on Vercel (production, preview or staging): only on a developer's machine and in CI.
    if (env.VERCEL || env.VERCEL_ENV)
      throw new Error("STRIPE_DRIVER=fake is not allowed on Vercel");
    return { driver };
  }
  if (driver !== "stripe") throw new Error("STRIPE_DRIVER must be stripe or fake");
  const secretKey = required(env, "STRIPE_SECRET_KEY");
  const match = STRIPE_KEY.exec(secretKey);
  if (!match) throw new Error("STRIPE_SECRET_KEY must be a Stripe secret or restricted key");
  const livemode = match[2] === "live";
  if (livemode && env.VERCEL_ENV !== "production")
    throw new Error("STRIPE_SECRET_KEY must be a test-mode key outside production");
  return { driver, secretKey, livemode };
}

/**
 * STRIPE_WEBHOOK_SECRET: the signing secrets (whsec_…) of the event destinations that send to the webhook,
 * comma-separated: one for the snapshot (v1) destination of connected accounts' events, one for the thin (Accounts v2)
 * destination, one for the platform's own checkout events (ADR 0023), and a second for each while it is being rolled;
 * at most six, none twice (ADR 0020 amendment). The fake driver signs its simulated events with the first one, so CI
 * sets a random one per run.
 */
export function stripeWebhookSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const secrets = required(env, "STRIPE_WEBHOOK_SECRET")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (
    secrets.length === 0 ||
    secrets.length > 6 ||
    secrets.some((s) => !/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(s))
  )
    throw new Error("STRIPE_WEBHOOK_SECRET must be one to six whsec_ signing secrets");
  // Security review 8: a repeated secret is almost always a missing one (the other destination's) pasted twice.
  if (new Set(secrets).size !== secrets.length)
    throw new Error("STRIPE_WEBHOOK_SECRET lists the same signing secret twice");
  return secrets;
}

// ── The parent shop (Phase 1 step 9; ADR 0022) ───────────────────────────────────────────────────────────────────────

/**
 * SHOP_TRUST_XFF: "1" lets the parent shop count requests by the `x-forwarded-for` header (security review R6). Only for
 * development, CI and end-to-end runs behind a local server that sets it; ignored on Vercel (VERCEL or VERCEL_ENV set),
 * where only Vercel's own `x-vercel-forwarded-for` is read. Unset anywhere else, every request shares one strict bucket,
 * so a deployment a client can send the header to can't be spoofed into fresh counts.
 */
export function shopTrustForwardedFor(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return env.SHOP_TRUST_XFF?.trim() === "1" && !env.VERCEL && !env.VERCEL_ENV;
}

/**
 * SHOP_THROTTLE_KEY: keys the HMACs the parent shop counts wrong access codes and requests by (a network, and a network
 * with a device; answer 2 and call 4 of the step 9 brief), so no address is ever stored. Standard base64 of exactly 32
 * random bytes (`openssl rand -base64 32`), different from both access code keys. Server-only, never NEXT_PUBLIC_*;
 * read on first use, never at build time. Errors name the variable, never the value. Changing it only restarts every
 * count.
 */
export function shopThrottleKey(
  env: Record<string, string | undefined> = process.env,
): Uint8Array<ArrayBuffer> {
  const problem = new Error(
    "SHOP_THROTTLE_KEY must be 32 random bytes, base64-encoded (openssl rand -base64 32)",
  );
  const text = env.SHOP_THROTTLE_KEY?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw problem;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw problem;
  }
  if (binary.length !== 32) throw problem;
  for (const other of ["ACCESS_CODE_HMAC_KEY", "ACCESS_CODE_ENCRYPTION_KEY"])
    if (env[other]?.trim() === text)
      throw new Error(`SHOP_THROTTLE_KEY must be different from ${other}`);
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

// ── DRM screenshot protection, test page (spike; D158; ADR 0032) ─────────────────────────────────────────────────────

/**
 * DRM_TEST_PAGE_ENABLED: "true" turns on /dev/drm-test and its token route for owners and admins. Anything else (the
 * default, unset) and both answer as if they didn't exist. Never in Vercel Production (VERCEL_ENV=production), which
 * is staging today: the test runs on the branch's Preview deployment only (Seenu, Oct 14, 2026; ADR 0032). The web
 * app's build step refuses the same way (lib/drm-test-build.mjs).
 */
export function drmTestPageEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env.DRM_TEST_PAGE_ENABLED?.trim() === "true" && env.VERCEL_ENV !== "production";
}

/**
 * What the DRM test page's token route needs (D158; ADR 0032), all server-only and never NEXT_PUBLIC_*:
 * - AXINOM_COM_KEY_ID: the communication key's ID (a GUID), from Axinom's portal. Not secret, but kept with its key.
 * - AXINOM_COM_KEY: the communication key itself, base64 of 32 bytes, from the same place. Secret: it signs license
 *   tokens and wraps content keys.
 * - AXINOM_LICENSE_PREFIX: the tenant part of Axinom's license server addresses,
 *   https://<prefix>.drm-{widevine,playready,fairplay}-licensing.axprod.net/AcquireLicense.
 * - AXINOM_FAIRPLAY_CERT_URL: optional; the HTTPS address of the studio's FairPlay (FPS) certificate. Unset, FairPlay
 *   is off and Safari gets the fallback.
 * - DRM_TEST_KEY_ID: the test clip's key ID, a random GUID (not secret: it is in the clip's manifest).
 * - DRM_TEST_CONTENT_KEY: the test clip's content key, 32 random hex digits. Secret. Set in Vercel only: the web app's
 *   build encrypts the clip with this same pair (apps/web/scripts/encrypt-drm-test.mjs; scripts/drm/README.md).
 * Read on first use, never at build time. Errors name the variable, never the value.
 */
export interface DrmTestSettings {
  comKeyId: string;
  comKey: Uint8Array<ArrayBuffer>;
  licensePrefix: string;
  fairplayCertificateUrl: string | null;
  keyId: string;
  contentKey: Uint8Array<ArrayBuffer>;
}

const GUID = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;

/** A GUID with or without dashes, as lowercase with dashes. */
function guidSetting(env: Record<string, string | undefined>, name: string): string {
  const value = required(env, name);
  if (!GUID.test(value)) throw new Error(`${name} must be a GUID`);
  const hex = value.replaceAll("-", "").toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function hexBytes(hex: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(hex.match(/../g) ?? [], (pair) => Number.parseInt(pair, 16));
}

export function drmTestSettings(
  env: Record<string, string | undefined> = process.env,
): DrmTestSettings {
  const comKeyId = guidSetting(env, "AXINOM_COM_KEY_ID");

  const comKeyProblem = new Error("AXINOM_COM_KEY must be 32 bytes, base64-encoded");
  const comKeyText = required(env, "AXINOM_COM_KEY");
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(comKeyText)) throw comKeyProblem;
  let binary: string;
  try {
    binary = atob(comKeyText);
  } catch {
    throw comKeyProblem;
  }
  if (binary.length !== 32) throw comKeyProblem;
  const comKey = Uint8Array.from(binary, (c) => c.charCodeAt(0));

  const licensePrefix = required(env, "AXINOM_LICENSE_PREFIX").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(licensePrefix))
    throw new Error("AXINOM_LICENSE_PREFIX must be the tenant part of Axinom's license address");

  const certText = env.AXINOM_FAIRPLAY_CERT_URL?.trim() ?? "";
  let fairplayCertificateUrl: string | null = null;
  if (certText) {
    let url: URL | null = null;
    try {
      url = new URL(certText);
    } catch {
      url = null;
    }
    if (url?.protocol !== "https:")
      throw new Error("AXINOM_FAIRPLAY_CERT_URL must be an https:// address");
    fairplayCertificateUrl = url.href;
  }

  const keyId = guidSetting(env, "DRM_TEST_KEY_ID");
  const contentKeyText = required(env, "DRM_TEST_CONTENT_KEY").replaceAll("-", "");
  if (!/^[0-9a-f]{32}$/i.test(contentKeyText))
    throw new Error("DRM_TEST_CONTENT_KEY must be 16 bytes as 32 hex digits");
  if (contentKeyText.toLowerCase() === keyId.replaceAll("-", ""))
    throw new Error("DRM_TEST_CONTENT_KEY must be different from DRM_TEST_KEY_ID");

  return {
    comKeyId,
    comKey,
    licensePrefix,
    fairplayCertificateUrl,
    keyId,
    contentKey: hexBytes(contentKeyText),
  };
}

// ── DRM in the parent shop's large view (D158; ADR 0034) ─────────────────────────────────────────────────────────────

/**
 * What the shop's DRM routes need to sign Axinom license tokens (D158; ADR 0034), all server-only, never NEXT_PUBLIC_*,
 * read on first use (never at build time):
 * - SHOP_DRM_COM_KEY_ID: the shop's communication key ID (a GUID), from Axinom's portal.
 * - SHOP_DRM_COM_KEY: that communication key, base64 of 32 bytes. Secret (Sensitive in Vercel): it signs tokens and
 *   wraps content keys. Must never be the DRM test page's AXINOM_COM_KEY (ADR 0032: a separate key for testing).
 * - SHOP_DRM_LICENSE_PREFIX: the tenant part of https://<prefix>.drm-{widevine,playready,fairplay}-licensing.axprod.net.
 * - SHOP_DRM_FAIRPLAY_CERT: optional; the FairPlay (FPS) certificate as base64 of its DER bytes, served from our own
 *   origin (C10). Unset, FairPlay is off and Safari keeps the watermarked WebP.
 * Null when none of the three required settings is set (DRM isn't set up in this environment: the shop keeps the
 * WebP); one set without the others, or a malformed one, throws. Errors name the variable, never the value.
 */
export interface ShopDrmSettings {
  comKeyId: string;
  comKey: Uint8Array<ArrayBuffer>;
  licensePrefix: string;
  fairplayCertificate: Uint8Array<ArrayBuffer> | null;
}

/** A FairPlay certificate is about 1 KB; anything over this isn't one. */
const MAX_FAIRPLAY_CERT_BYTES = 16 * 1024;

function base64Bytes(text: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return null;
  try {
    return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

export function shopDrmSettings(
  env: Record<string, string | undefined> = process.env,
): ShopDrmSettings | null {
  const names = ["SHOP_DRM_COM_KEY_ID", "SHOP_DRM_COM_KEY", "SHOP_DRM_LICENSE_PREFIX"] as const;
  if (names.every((name) => !env[name]?.trim())) return null;
  const comKeyId = guidSetting(env, "SHOP_DRM_COM_KEY_ID");
  const comKeyText = required(env, "SHOP_DRM_COM_KEY");
  const comKey = base64Bytes(comKeyText);
  if (comKey?.length !== 32) throw new Error("SHOP_DRM_COM_KEY must be 32 bytes, base64-encoded");
  const testKey = base64Bytes(env.AXINOM_COM_KEY?.trim() ?? "");
  if (testKey?.length === comKey.length && testKey.every((b, i) => b === comKey[i]))
    throw new Error("SHOP_DRM_COM_KEY must be different from AXINOM_COM_KEY");
  const licensePrefix = required(env, "SHOP_DRM_LICENSE_PREFIX").toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(licensePrefix))
    throw new Error("SHOP_DRM_LICENSE_PREFIX must be the tenant part of Axinom's license address");
  const certText = env.SHOP_DRM_FAIRPLAY_CERT?.trim() ?? "";
  let fairplayCertificate: Uint8Array<ArrayBuffer> | null = null;
  if (certText) {
    fairplayCertificate = base64Bytes(certText);
    // DER starts with a SEQUENCE (0x30).
    if (
      !fairplayCertificate ||
      fairplayCertificate.length < 64 ||
      fairplayCertificate.length > MAX_FAIRPLAY_CERT_BYTES ||
      fairplayCertificate[0] !== 0x30
    )
      throw new Error(
        "SHOP_DRM_FAIRPLAY_CERT must be the FairPlay certificate's DER bytes, base64",
      );
  }
  return { comKeyId, comKey, licensePrefix, fairplayCertificate };
}

const IAM_ROLE = /^arn:aws:iam::\d{12}:role\/[\w+=,.@/-]{1,128}$/;

/**
 * AWS_DRM_ROLE_ARN (ADR 0034, B4): the role only the shop's DRM token route assumes (Vercel's OIDC token, like
 * AWS_ROLE_ARN) to unwrap a photo's content key: kms:Decrypt on the DRM key, with the encryption context required, and
 * nothing else. Distinct from AWS_ROLE_ARN and AWS_DOWNLOAD_ROLE_ARN, so neither of those can ever unwrap a key. Null
 * with the local driver and for regions without photo storage. Named, never shown, when it is missing.
 */
export function awsDrmRoleArn(
  region: DataRegion,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const settings = photoStorageSettings(region, env);
  if (settings?.driver !== "s3") return null;
  const value = required(env, "AWS_DRM_ROLE_ARN");
  if (!IAM_ROLE.test(value)) throw new Error("AWS_DRM_ROLE_ARN must be an IAM role ARN");
  if (value === settings.roleArn)
    throw new Error("AWS_DRM_ROLE_ARN must be a different role from AWS_ROLE_ARN");
  if (value === env.AWS_DOWNLOAD_ROLE_ARN?.trim())
    throw new Error("AWS_DRM_ROLE_ARN must be a different role from AWS_DOWNLOAD_ROLE_ARN");
  return value;
}

/**
 * DRM_KMS_KEY_ARN_CA (ADR 0034): the KMS key that wraps each photo's content key, in ca-central-1 like the photos
 * (D113). Its key ARN, not its alias: the token route refuses any wrapped key whose KMS key isn't exactly this one
 * (review L3). Its being set is what turns DRM packaging on in this environment: unset, nothing is packaged and the shop
 * keeps the WebP. Null with the local driver (no packaging locally) and for regions without photo storage. Anything
 * else throws, naming the variable.
 */
export function drmKmsKeyArn(
  region: DataRegion,
  env: Record<string, string | undefined> = process.env,
): string | null {
  const settings = photoStorageSettings(region, env);
  if (settings?.driver !== "s3") return null;
  const name = `DRM_KMS_KEY_ARN_${region.toUpperCase()}`;
  const value = env[name]?.trim() ?? "";
  if (!value) return null;
  const pattern = new RegExp(`^arn:aws:kms:${settings.awsRegion}:\\d{12}:key/[0-9a-f-]{36}$`);
  if (!pattern.test(value))
    throw new Error(`${name} must be a KMS key ARN in ${settings.awsRegion}`);
  return value;
}
