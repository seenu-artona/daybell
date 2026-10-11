/**
 * Server-only secrets for parent access codes (ADR 0011). Both are standard base64 of exactly 32 random bytes
 * (`openssl rand -base64 32`):
 * - ACCESS_CODE_HMAC_KEY: keys the lookup hash. One per deployment, shared by every studio, since lookup is global.
 * - ACCESS_CODE_ENCRYPTION_KEY: encrypts the copy studios see and print.
 * Read lazily on first use, never at build time and never as NEXT_PUBLIC_*. Errors never include the value.
 */
export interface AccessCodeKeys {
  hmacKey: Uint8Array<ArrayBuffer>;
  encryptionKey: Uint8Array<ArrayBuffer>;
}

const KEY_BYTES = 32;

function decodeKey(name: string, value: string | undefined): Uint8Array<ArrayBuffer> {
  const problem = new Error(
    `${name} must be ${KEY_BYTES} random bytes, base64-encoded (openssl rand -base64 32)`,
  );
  const text = value?.trim() ?? "";
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) throw problem;
  let binary: string;
  try {
    binary = atob(text);
  } catch {
    throw problem;
  }
  if (binary.length !== KEY_BYTES) throw problem;
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

export function accessCodeKeys(
  env: Record<string, string | undefined> = process.env,
): AccessCodeKeys {
  const hmacKey = decodeKey("ACCESS_CODE_HMAC_KEY", env.ACCESS_CODE_HMAC_KEY);
  const encryptionKey = decodeKey("ACCESS_CODE_ENCRYPTION_KEY", env.ACCESS_CODE_ENCRYPTION_KEY);
  if (hmacKey.every((b, i) => b === encryptionKey[i])) {
    throw new Error("ACCESS_CODE_HMAC_KEY and ACCESS_CODE_ENCRYPTION_KEY must be different keys");
  }
  return { hmacKey, encryptionKey };
}
