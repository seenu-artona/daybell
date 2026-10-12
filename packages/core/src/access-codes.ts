/**
 * Parent access codes (Phase 1 step 2, ADR 0011; D24, F13). Eight symbols shown as K7QM-4XPA, from an alphabet with no
 * look-alikes (no 0/O, 1/I/L). The first symbol tells which regional database holds the code (D113), so a code is
 * never ambiguous between the US and Canada. Codes are generated with a CSPRNG, looked up by an HMAC and kept as an
 * AES-256-GCM copy bound to the child's id. WebCrypto only (works in Node 22 and browsers); keys are passed in, and
 * only the server ever has them. Never log, store in events, or put a code in a URL.
 */

export const ACCESS_CODE_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export const ACCESS_CODE_LENGTH = 8;

export type AccessCodeRegion = "us" | "ca";

/** First symbols by region: two disjoint sets that together make the whole alphabet. */
export const ACCESS_CODE_FIRST: Record<AccessCodeRegion, string> = {
  us: "23456789ABCDEFGH",
  ca: "JKMNPQRSTUVWXYZ",
};

const FIRST_LIMIT = 240;
const REST_LIMIT = 248;

const CODE = new RegExp(`^[${ACCESS_CODE_ALPHABET}]{${ACCESS_CODE_LENGTH}}$`);

export type RandomBytes = (bytes: Uint8Array<ArrayBuffer>) => Uint8Array<ArrayBuffer>;

const cryptoRandom: RandomBytes = (bytes) => crypto.getRandomValues(bytes);

/**
 * A new code for a studio in `region`. Rejection sampling keeps every symbol equally likely: a byte is used only when
 * it is below a multiple of the set size (240 for the 16- and 15-symbol first sets, 248 for the 31-symbol alphabet).
 */
export function generateAccessCode(
  region: AccessCodeRegion,
  random: RandomBytes = cryptoRandom,
): string {
  const sets: string[] = [
    ACCESS_CODE_FIRST[region],
    ...Array<string>(ACCESS_CODE_LENGTH - 1).fill(ACCESS_CODE_ALPHABET),
  ];
  let out = "";
  let buffer = new Uint8Array(0);
  let at = 0;
  for (const [i, set] of sets.entries()) {
    // 240 = 16 × 15 serves both regions' first sets, so they behave the same; 248 = 31 × 8.
    const limit = i === 0 ? FIRST_LIMIT : REST_LIMIT;
    for (;;) {
      if (at >= buffer.length) {
        buffer = random(new Uint8Array(16));
        at = 0;
      }
      const byte = buffer[at++] as number;
      if (byte < limit) {
        out += set[byte % set.length];
        break;
      }
    }
  }
  return out;
}

/** "K7QM4XPA" -> "K7QM-4XPA", for screens and printed cards. */
export function formatAccessCode(code: string): string {
  return `${code.slice(0, 4)}-${code.slice(4)}`;
}

/** What a parent typed, in canonical form (upper case, no spaces or dashes), or null if it can't be a code. */
export function normalizeAccessCode(input: string): string | null {
  // Spaces and every kind of dash a phone keyboard might insert.
  const code = input.toUpperCase().replace(/[\s\-‐-―]/g, "");
  return CODE.test(code) ? code : null;
}

/** Which regional database a code belongs to. */
export function accessCodeRegion(code: string): AccessCodeRegion | null {
  const first = code[0];
  if (!first || !CODE.test(code)) return null;
  if (ACCESS_CODE_FIRST.us.includes(first)) return "us";
  if (ACCESS_CODE_FIRST.ca.includes(first)) return "ca";
  return null;
}

export interface AccessCodeCryptoKeys {
  hmac: CryptoKey;
  encryption: CryptoKey;
}

/** Turns the two raw 32-byte secrets into non-extractable WebCrypto keys. */
export async function importAccessCodeKeys(raw: {
  hmacKey: Uint8Array<ArrayBuffer>;
  encryptionKey: Uint8Array<ArrayBuffer>;
}): Promise<AccessCodeCryptoKeys> {
  const [hmac, encryption] = await Promise.all([
    crypto.subtle.importKey("raw", raw.hmacKey, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]),
    crypto.subtle.importKey("raw", raw.encryptionKey, { name: "AES-GCM" }, false, [
      "encrypt",
      "decrypt",
    ]),
  ]);
  return { hmac, encryption };
}

const encoder = new TextEncoder();

/** The lookup hash: HMAC-SHA256 of the canonical code, as 64 lowercase hex characters. */
export async function hashAccessCode(code: string, hmacKey: CryptoKey): Promise<string> {
  const mac = await crypto.subtle.sign(
    "HMAC",
    hmacKey,
    encoder.encode(`daybell:access-code:v1:${code}`),
  );
  return Array.from(new Uint8Array(mac), (b) => b.toString(16).padStart(2, "0")).join("");
}

const IV_BYTES = 12;
const PREFIX = "v1.";

function toBase64Url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

/**
 * What an encrypted copy is bound to: a child, or a blank QR card (ADR 0015) until the card is tagged and its code
 * moves to the new child. The two never share associated data, so a card's copy can't be read as a child's.
 */
export type AccessCodeOwner = { child: string } | { card: string };

const associatedData = (owner: AccessCodeOwner) =>
  encoder.encode("child" in owner ? `daybell:child:${owner.child}` : `daybell:card:${owner.card}`);

async function seal(
  code: string,
  owner: AccessCodeOwner,
  encryptionKey: CryptoKey,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const sealed = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: associatedData(owner) },
    encryptionKey,
    encoder.encode(code),
  );
  const out = new Uint8Array(IV_BYTES + sealed.byteLength);
  out.set(iv);
  out.set(new Uint8Array(sealed), IV_BYTES);
  return PREFIX + toBase64Url(out);
}

async function open(
  ciphertext: string,
  owner: AccessCodeOwner,
  encryptionKey: CryptoKey,
): Promise<string> {
  if (!ciphertext.startsWith(PREFIX)) throw new Error("Unreadable access code");
  const bytes = fromBase64Url(ciphertext.slice(PREFIX.length));
  let opened: ArrayBuffer;
  try {
    opened = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: bytes.slice(0, IV_BYTES), additionalData: associatedData(owner) },
      encryptionKey,
      bytes.slice(IV_BYTES),
    );
  } catch {
    throw new Error("Unreadable access code");
  }
  const code = new TextDecoder().decode(opened);
  if (!CODE.test(code)) throw new Error("Unreadable access code");
  return code;
}

/**
 * The studio's readable copy: "v1." + base64url(IV | ciphertext | tag), 48 characters after the prefix. The child's id
 * is the associated data, so a copy moved to another child's row fails to decrypt.
 */
export function encryptAccessCode(
  code: string,
  childId: string,
  encryptionKey: CryptoKey,
): Promise<string> {
  return seal(code, { child: childId }, encryptionKey);
}

/** The code from its encrypted copy. Throws (without saying why) if the copy, key or child doesn't match. */
export function decryptAccessCode(
  ciphertext: string,
  childId: string,
  encryptionKey: CryptoKey,
): Promise<string> {
  return open(ciphertext, { child: childId }, encryptionKey);
}

/** A blank QR card's copy of its pre-made code, bound to the card's id (ADR 0015). Same format as a child's. */
export function encryptCardAccessCode(
  code: string,
  cardId: string,
  encryptionKey: CryptoKey,
): Promise<string> {
  return seal(code, { card: cardId }, encryptionKey);
}

/**
 * A blank card's code from its encrypted copy. Throws if the copy, key or card doesn't match. Not used yet: tagging
 * (step 5) reads it to move the code to the new child.
 */
export function decryptCardAccessCode(
  ciphertext: string,
  cardId: string,
  encryptionKey: CryptoKey,
): Promise<string> {
  return open(ciphertext, { card: cardId }, encryptionKey);
}
