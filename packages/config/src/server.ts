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
 * STRIPE_WEBHOOK_SECRET: the webhook endpoint's signing secret (whsec_…), or two comma-separated while one is being
 * rolled. The fake driver signs its simulated events with the first one, so CI sets a random one per run.
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
    secrets.length > 2 ||
    secrets.some((s) => !/^whsec_[A-Za-z0-9+/=_-]{16,}$/.test(s))
  )
    throw new Error("STRIPE_WEBHOOK_SECRET must be one or two whsec_ signing secrets");
  return secrets;
}
