import "server-only";
import { createCipheriv, createHmac } from "node:crypto";
import type { DrmTestSettings } from "@daybell/config/server";

/**
 * License tokens for the DRM test page (D158; ADR 0032): Axinom's direct-key model, where the token itself carries the
 * test clip's content key, wrapped with the communication key, so Axinom never stores a key of ours.
 *
 * The shapes follow Axinom's "Entitlement message" and "Signing license service message" pages as summarised in the
 * D158 research notes. docs.axinom.com could not be reached when this was written, so the field names below are to
 * be checked against those pages on staging (ADR 0032, open questions).
 *
 * Nothing here logs: the token and both keys are secret, and the key ID is the only identifier in the message.
 */

/** A token is good for at most this long; the page asks for a fresh one for each license request. */
export const DRM_TOKEN_TTL_SECONDS = 60;
export const DRM_TEST_POLICY = "Policy A";

/** A GUID's 16 bytes in the order it is written (big-endian), the way the key ID sits in the clip. */
export function guidBytes(guid: string): Buffer {
  const hex = guid.replaceAll("-", "");
  if (!/^[0-9a-fA-F]{32}$/.test(hex)) throw new Error("guidBytes needs a GUID");
  return Buffer.from(hex, "hex");
}

/**
 * The content key wrapped for Axinom: AES-256-CBC without padding (the key is exactly one 16-byte block), keyed with
 * the communication key, with the key ID's bytes as the IV. Base64.
 */
export function encryptContentKey(
  contentKey: Uint8Array,
  comKey: Uint8Array,
  keyId: string,
): string {
  if (contentKey.length !== 16) throw new Error("A content key is 16 bytes");
  if (comKey.length !== 32) throw new Error("A communication key is 32 bytes");
  const cipher = createCipheriv("aes-256-cbc", comKey, guidBytes(keyId));
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(contentKey), cipher.final()]).toString("base64");
}

/**
 * The entitlement message: one key, one usage policy that asks for hardware-backed DRM on every system (that is what
 * makes screenshots black: D158). Widevine L1 with the whole path in hardware, PlayReady SL3000, FairPlay with HDCP
 * type 1 and no AirPlay or AV adapter. No persistence: nothing is kept on the device.
 */
export function entitlementMessage(
  settings: Pick<DrmTestSettings, "keyId" | "contentKey" | "comKey">,
) {
  return {
    version: 2,
    type: "entitlement_message",
    license: { allow_persistence: false },
    content_keys_source: {
      inline: [
        {
          id: settings.keyId,
          encrypted_key: encryptContentKey(settings.contentKey, settings.comKey, settings.keyId),
          usage_policy: DRM_TEST_POLICY,
        },
      ],
    },
    content_key_usage_policies: [
      {
        name: DRM_TEST_POLICY,
        widevine: { device_security_level: "HW_SECURE_ALL" },
        playready: { min_device_security_level: 3000 },
        fairplay: { hdcp: "TYPE1", allow_airplay: false, allow_av_adapter: false },
      },
    ],
  };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/**
 * The license token: a JWT, HS256, signed with the communication key's bytes (the portal shows it as base64; it is
 * decoded before signing). begin_date and expiration_date bound it to DRM_TOKEN_TTL_SECONDS from `now`.
 */
export function licenseToken(
  settings: Pick<DrmTestSettings, "comKeyId" | "comKey" | "keyId" | "contentKey">,
  now: Date = new Date(),
): { token: string; expiresAt: string } {
  const begin = new Date(Math.floor(now.getTime() / 1000) * 1000);
  const expires = new Date(begin.getTime() + DRM_TOKEN_TTL_SECONDS * 1000);
  const payload = {
    version: 1,
    com_key_id: settings.comKeyId,
    begin_date: begin.toISOString(),
    expiration_date: expires.toISOString(),
    message: entitlementMessage(settings),
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", settings.comKey).update(unsigned).digest("base64url");
  return { token: `${unsigned}.${signature}`, expiresAt: expires.toISOString() };
}

/** Axinom's license servers for a tenant. The token goes in the X-AxDRM-Message header. */
export function licenseUrls(prefix: string, fairplay: boolean) {
  const url = (system: string) =>
    `https://${prefix}.drm-${system}-licensing.axprod.net/AcquireLicense`;
  return {
    widevine: url("widevine"),
    playready: url("playready"),
    fairplay: fairplay ? url("fairplay") : null,
  };
}
