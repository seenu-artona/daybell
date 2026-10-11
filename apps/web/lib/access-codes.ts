import "server-only";
import { ApiError } from "@daybell/api";
import { accessCodeKeys } from "@daybell/config";
import {
  type AccessCodeCryptoKeys,
  type AccessCodeRegion,
  encryptAccessCode,
  generateAccessCode,
  hashAccessCode,
  importAccessCodeKeys,
} from "@daybell/core";

let keys: Promise<AccessCodeCryptoKeys> | null = null;

/**
 * The access code keys, imported once per process (ADR 0011). Read on first use, so builds never need them. A missing
 * or malformed key is logged by name only, never by value.
 */
export function accessCodeCryptoKeys(): Promise<AccessCodeCryptoKeys> {
  if (!keys) {
    let raw: ReturnType<typeof accessCodeKeys>;
    try {
      raw = accessCodeKeys();
    } catch {
      console.error("access_code_keys_missing");
      throw new ApiError("internal", "Something went wrong on our side. Please try again.");
    }
    keys = importAccessCodeKeys(raw);
  }
  return keys;
}

/** A fresh code for a new child: the lookup hash and the encrypted copy bound to the child's id. */
export async function newAccessCode(
  region: AccessCodeRegion,
  childId: string,
  cryptoKeys: AccessCodeCryptoKeys,
): Promise<{ hash: string; ciphertext: string }> {
  const code = generateAccessCode(region);
  const [hash, ciphertext] = await Promise.all([
    hashAccessCode(code, cryptoKeys.hmac),
    encryptAccessCode(code, childId, cryptoKeys.encryption),
  ]);
  return { hash, ciphertext };
}
