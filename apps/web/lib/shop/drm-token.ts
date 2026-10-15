import "server-only";
import { createCipheriv, createHmac } from "node:crypto";
import {
  DRM_TOKEN_CLOCK_SKEW_SECONDS,
  DRM_TOKEN_TTL_SECONDS,
  guidBytes as guidByteArray,
} from "@daybell/core";

/**
 * Axinom license tokens (D158), shared by the parent shop's large view (ADR 0034) and the DRM test page (ADR 0032): the
 * direct-key model, where the token itself carries the content key, wrapped with the communication key, so Axinom never
 * stores a key of ours. One key per token: a photo's (B2), or the test clip's.
 *
 * The shapes follow Axinom's "Entitlement message" and "Signing license service message" pages as summarised in the
 * D158 research notes; the device tests showed Axinom accepts the envelope, the signature and the IV (ADR 0032). No
 * name, code, studio, child or photo id is ever in a token.
 *
 * Nothing here logs: the token and both keys are secret, and the key ID is the only identifier in the message.
 */

export { DRM_TOKEN_CLOCK_SKEW_SECONDS, DRM_TOKEN_TTL_SECONDS };
/** Hardware DRM on every system (that is what makes screenshots black: D158). */
export const DRM_POLICY = "Policy A";

/** Who signs: the communication key's ID and its 32 bytes. */
export interface LicenseSigner {
  comKeyId: string;
  comKey: Uint8Array;
}

/** What the token unlocks: one content key and its ID. */
export interface LicenseKey {
  keyId: string;
  contentKey: Uint8Array;
}

/** A GUID's 16 bytes in the order it is written (big-endian), the way the key ID sits in the clip. */
export function guidBytes(guid: string): Buffer {
  return Buffer.from(guidByteArray(guid));
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
 * The clip's constant cbcs IV, base64: the key ID's 16 bytes, exactly what the packager used (core's drmIvHex; the
 * spike's lib/drm-test-build.mjs). FairPlay needs it in the license, so Axinom requires it with every inline key;
 * Widevine and PlayReady read the IV from the clip and ignore it. Not secret.
 */
export function contentKeyIv(keyId: string): string {
  return guidBytes(keyId).toString("base64");
}

/**
 * The entitlement message: one key, one usage policy that asks for hardware-backed DRM on every system. Widevine L1
 * with the whole path in hardware, PlayReady SL3000, FairPlay with HDCP type 1 (C12) and no AirPlay or AV adapter. No
 * persistence: nothing is kept on the device.
 */
export function entitlementMessage(signer: Pick<LicenseSigner, "comKey">, key: LicenseKey) {
  return {
    version: 2,
    type: "entitlement_message",
    license: { allow_persistence: false },
    content_keys_source: {
      inline: [
        {
          id: key.keyId,
          encrypted_key: encryptContentKey(key.contentKey, signer.comKey, key.keyId),
          iv: contentKeyIv(key.keyId),
          usage_policy: DRM_POLICY,
        },
      ],
    },
    content_key_usage_policies: [
      {
        name: DRM_POLICY,
        widevine: { device_security_level: "HW_SECURE_ALL" },
        playready: { min_device_security_level: 3000 },
        fairplay: { hdcp: "TYPE1", allow_airplay: false, allow_av_adapter: false },
      },
    ],
  };
}

const base64url = (data: Buffer | string) => Buffer.from(data).toString("base64url");

/**
 * The license token: a JWT, HS256, signed with the communication key's bytes. Good from DRM_TOKEN_CLOCK_SKEW_SECONDS
 * before `now` until DRM_TOKEN_TTL_SECONDS after it. No jti and no prevent_drm_message_reuse until Axinom's schema is
 * confirmed (C4).
 */
export function licenseToken(
  signer: LicenseSigner,
  key: LicenseKey,
  now: Date = new Date(),
): { token: string; expiresAt: string } {
  const second = Math.floor(now.getTime() / 1000) * 1000;
  const begin = new Date(second - DRM_TOKEN_CLOCK_SKEW_SECONDS * 1000);
  const expires = new Date(second + DRM_TOKEN_TTL_SECONDS * 1000);
  const payload = {
    version: 1,
    com_key_id: signer.comKeyId,
    begin_date: begin.toISOString(),
    expiration_date: expires.toISOString(),
    message: entitlementMessage(signer, key),
  };
  const unsigned = `${base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))}.${base64url(JSON.stringify(payload))}`;
  const signature = createHmac("sha256", signer.comKey).update(unsigned).digest("base64url");
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
