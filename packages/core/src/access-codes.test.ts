import { describe, expect, it } from "vitest";
import {
  ACCESS_CODE_ALPHABET,
  ACCESS_CODE_FIRST,
  accessCodeRegion,
  decryptAccessCode,
  decryptCardAccessCode,
  encryptAccessCode,
  encryptCardAccessCode,
  formatAccessCode,
  generateAccessCode,
  hashAccessCode,
  importAccessCodeKeys,
  normalizeAccessCode,
} from "./access-codes";

const CODE = new RegExp(`^[${ACCESS_CODE_ALPHABET}]{8}$`);
const random32 = () => crypto.getRandomValues(new Uint8Array(32));
const keys = () => importAccessCodeKeys({ hmacKey: random32(), encryptionKey: random32() });
const CHILD = "0b6f7c1e-2a7d-4c55-9d0e-3f1a2b3c4d5e";
const OTHER_CHILD = "1c7a8d2f-3b8e-4d66-8e1f-4a2b3c4d5e6f";

describe("access code alphabet", () => {
  it("has 31 symbols and no look-alikes", () => {
    expect(ACCESS_CODE_ALPHABET).toHaveLength(31);
    expect(new Set(ACCESS_CODE_ALPHABET).size).toBe(31);
    for (const c of "0O1IL") expect(ACCESS_CODE_ALPHABET).not.toContain(c);
  });

  it("splits first symbols by region: disjoint, together the whole alphabet", () => {
    const us = new Set(ACCESS_CODE_FIRST.us);
    const ca = new Set(ACCESS_CODE_FIRST.ca);
    expect([...us].filter((c) => ca.has(c))).toEqual([]);
    expect([...ACCESS_CODE_FIRST.us, ...ACCESS_CODE_FIRST.ca].sort().join("")).toBe(
      [...ACCESS_CODE_ALPHABET].sort().join(""),
    );
  });
});

describe("generateAccessCode", () => {
  it("makes 8-symbol codes whose first symbol names the region", () => {
    for (const region of ["us", "ca"] as const) {
      for (let i = 0; i < 5000; i++) {
        const code = generateAccessCode(region);
        expect(code).toMatch(CODE);
        expect(ACCESS_CODE_FIRST[region]).toContain(code[0]);
        expect(accessCodeRegion(code)).toBe(region);
      }
    }
  });

  it("skips bytes that would bias the result (rejection sampling)", () => {
    // First symbol: 240+ is rejected; then 31-symbol positions: 248+ is rejected.
    const bytes = [255, 240, 17, 250, 248, 0, 1, 2, 30, 31, 247, 62];
    let at = 0;
    const fake = (b: Uint8Array<ArrayBuffer>) => {
      for (let i = 0; i < b.length; i++) b[i] = bytes[at++] ?? 0;
      return b;
    };
    const code = generateAccessCode("us", fake);
    const a = ACCESS_CODE_ALPHABET;
    // 17 % 16 = 1 -> "3"; then 0, 1, 2, 30, 31 % 31 = 0, 247 % 31 = 30, 62 % 31 = 0.
    expect(code).toBe(`3${a[0]}${a[1]}${a[2]}${a[30]}${a[0]}${a[30]}${a[0]}`);
  });

  it("uses every symbol about equally often", () => {
    const counts = new Map<string, number>();
    const n = 20000;
    for (let i = 0; i < n; i++) {
      for (const c of generateAccessCode("ca").slice(1)) counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const expected = (n * 7) / 31;
    const chiSquare = [...ACCESS_CODE_ALPHABET].reduce(
      (sum, c) => sum + ((counts.get(c) ?? 0) - expected) ** 2 / expected,
      0,
    );
    // 30 degrees of freedom: the 99.99th percentile is about 70.
    expect(chiSquare).toBeLessThan(70);
  });
});

describe("formatting and reading codes", () => {
  it("shows codes with a dash in the middle", () => {
    expect(formatAccessCode("K7QM4XPA")).toBe("K7QM-4XPA");
  });

  it("reads what a parent typed", () => {
    expect(normalizeAccessCode(" k7qm-4xpa ")).toBe("K7QM4XPA");
    expect(normalizeAccessCode("K7QM 4XPA")).toBe("K7QM4XPA");
    expect(normalizeAccessCode("K7QM–4XPA")).toBe("K7QM4XPA");
    for (const bad of [
      "K7QM-4XP0",
      "K7QM-4XPO",
      "K7QM-4XP1",
      "K7QM-4XPI",
      "K7QM-4XPL",
      "K7QM-4XP",
      "",
    ])
      expect(normalizeAccessCode(bad)).toBeNull();
  });

  it("knows the region of a code", () => {
    expect(accessCodeRegion("27QM4XPA")).toBe("us");
    expect(accessCodeRegion("K7QM4XPA")).toBe("ca");
    expect(accessCodeRegion("O7QM4XPA")).toBeNull();
  });
});

describe("hashing codes", () => {
  it("is a keyed, deterministic hex digest that never contains the code", async () => {
    const a = await keys();
    const b = await keys();
    const hash = await hashAccessCode("K7QM4XPA", a.hmac);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashAccessCode("K7QM4XPA", a.hmac)).toBe(hash);
    expect(await hashAccessCode("K7QM4XPA", b.hmac)).not.toBe(hash);
    expect(await hashAccessCode("K7QM4XPB", a.hmac)).not.toBe(hash);
    expect(hash.toUpperCase()).not.toContain("K7QM4XPA");
  });
});

describe("encrypting codes", () => {
  it("round-trips in the v1 format, with a fresh IV each time", async () => {
    const { encryption } = await keys();
    const sealed = await encryptAccessCode("K7QM4XPA", CHILD, encryption);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{48}$/);
    expect(await encryptAccessCode("K7QM4XPA", CHILD, encryption)).not.toBe(sealed);
    expect(await decryptAccessCode(sealed, CHILD, encryption)).toBe("K7QM4XPA");
  });

  it("refuses a copy moved to another child", async () => {
    const { encryption } = await keys();
    const sealed = await encryptAccessCode("K7QM4XPA", CHILD, encryption);
    await expect(decryptAccessCode(sealed, OTHER_CHILD, encryption)).rejects.toThrow();
  });

  it("refuses tampered copies and the wrong key", async () => {
    const { encryption } = await keys();
    const other = await keys();
    const sealed = await encryptAccessCode("K7QM4XPA", CHILD, encryption);
    const last = sealed.at(-1) === "A" ? "B" : "A";
    await expect(
      decryptAccessCode(sealed.slice(0, -1) + last, CHILD, encryption),
    ).rejects.toThrow();
    await expect(decryptAccessCode(sealed, CHILD, other.encryption)).rejects.toThrow();
    await expect(decryptAccessCode(`v2.${sealed.slice(3)}`, CHILD, encryption)).rejects.toThrow();
  });

  it("never puts the code in its error", async () => {
    const { encryption } = await keys();
    const sealed = await encryptAccessCode("K7QM4XPA", CHILD, encryption);
    await expect(decryptAccessCode(sealed, OTHER_CHILD, encryption)).rejects.not.toThrow(/K7QM/);
  });
});

describe("blank QR card codes (ADR 0015)", () => {
  it("round-trip bound to the card, in the same v1 format", async () => {
    const { encryption } = await keys();
    const sealed = await encryptCardAccessCode("K7QM4XPA", CHILD, encryption);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9_-]{48}$/);
    expect(await decryptCardAccessCode(sealed, CHILD, encryption)).toBe("K7QM4XPA");
    await expect(decryptCardAccessCode(sealed, OTHER_CHILD, encryption)).rejects.toThrow();
  });

  it("a card's copy is never readable as a child's with the same id, nor the other way round", async () => {
    const { encryption } = await keys();
    const card = await encryptCardAccessCode("K7QM4XPA", CHILD, encryption);
    const child = await encryptAccessCode("K7QM4XPA", CHILD, encryption);
    await expect(decryptAccessCode(card, CHILD, encryption)).rejects.toThrow();
    await expect(decryptCardAccessCode(child, CHILD, encryption)).rejects.toThrow();
  });
});
