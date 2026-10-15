import "server-only";
import { DecryptCommand, KMSClient } from "@aws-sdk/client-kms";
import { ApiError, SHOP_CONFLICTS } from "@daybell/api";
import type { DataRegion } from "@daybell/config";
import {
  awsDrmRoleArn,
  drmKmsKeyArn,
  PHOTO_AWS_REGION,
  type ShopDrmSettings,
  shopDrmSettings,
} from "@daybell/config/server";
import { awsCredentialsProvider } from "@vercel/oidc-aws-credentials-provider";

/**
 * The parent shop's DRM setup and keys (D158; ADR 0034). Server-only. A large view is protected only when all of these
 * hold: the database's switch is on (set_shop_drm), the shop's Axinom settings are set (SHOP_DRM_*), and this region
 * has the DRM KMS key and the DRM role (Canada). A missing or malformed setting turns DRM off (logged by variable name),
 * never into an error a parent sees: the shop shows the watermarked WebP. Never logs a key, a token or an id of a
 * person.
 */

export interface ShopDrmSetup {
  settings: ShopDrmSettings;
  roleArn: string;
  awsRegion: string;
}

/** The setup for a region, or null when DRM isn't set up there (the switch is read separately, per database). */
export function shopDrmSetup(region: DataRegion): ShopDrmSetup | null {
  try {
    const settings = shopDrmSettings();
    const awsRegion = PHOTO_AWS_REGION[region];
    if (!settings || !awsRegion || !drmKmsKeyArn(region)) return null;
    const roleArn = awsDrmRoleArn(region);
    return roleArn ? { settings, roleArn, awsRegion } : null;
  } catch (err) {
    // The message names the variable, never its value.
    console.error("shop_drm_misconfigured", err instanceof Error ? err.message : "unknown");
    return null;
  }
}

export const drmUnavailable = () =>
  new ApiError("conflict", "This photo isn't protected here.", {
    form: SHOP_CONFLICTS.drmUnavailable,
  });

/** What KMS needs to unwrap a photo's key: the context it was wrapped with (B2, B4), and the wrapped bytes. */
export interface WrappedDrmKey {
  studioId: string;
  photoId: string;
  keyId: string;
  /** Base64, as the database returns it. */
  wrappedKey: string;
  kmsKeyArn: string;
}

export interface KmsDecrypt {
  send(command: DecryptCommand): Promise<{ Plaintext?: Uint8Array }>;
}

const clients = new Map<string, KmsDecrypt>();

/** KMS in the photos' region, with the DRM role's short-lived credentials from Vercel's OIDC token. */
function kmsClient(setup: ShopDrmSetup): KmsDecrypt {
  const cached = clients.get(setup.roleArn);
  if (cached) return cached;
  const client = new KMSClient({
    region: setup.awsRegion,
    credentials: awsCredentialsProvider({
      roleArn: setup.roleArn,
      clientConfig: { region: setup.awsRegion },
    }),
  });
  clients.set(setup.roleArn, client);
  return client;
}

/**
 * The photo's 16-byte content key, unwrapped by KMS with the encryption context {studio, photo, key}: a wrapped key
 * copied to another photo or studio won't unwrap. Only in memory; the caller zeroes it once the token is signed.
 */
export async function unwrapContentKey(
  setup: ShopDrmSetup,
  key: WrappedDrmKey,
  client: KmsDecrypt = kmsClient(setup),
): Promise<Uint8Array> {
  let plaintext: Uint8Array | undefined;
  try {
    const out = await client.send(
      new DecryptCommand({
        KeyId: key.kmsKeyArn,
        CiphertextBlob: Buffer.from(key.wrappedKey, "base64"),
        EncryptionContext: { studio: key.studioId, photo: key.photoId, key: key.keyId },
      }),
    );
    plaintext = out.Plaintext;
  } catch (err) {
    // The error's name only: SDK messages can quote ARNs and request ids.
    console.error("shop_drm_unwrap_failed", err instanceof Error ? err.name : "unknown");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  if (plaintext?.length !== 16) {
    plaintext?.fill(0);
    console.error("shop_drm_unwrap_failed", "size");
    throw new ApiError("internal", "Something went wrong on our side. Please try again.");
  }
  return plaintext;
}
