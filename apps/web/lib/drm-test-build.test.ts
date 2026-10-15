import { createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildPlan,
  drmTestIvHex,
  GENERATED,
  guidSetting,
  PACKAGER_SHA256,
  packagerArgs,
  packagerEnv,
  packagerFileName,
  removeGenerated,
  scrub,
  verifyPackager,
} from "./drm-test-build.mjs";

// The DRM test clip's build step (spike; D158; ADR 0032): when it encrypts, how it checks its keys (the same rules as
// packages/config), that it never runs in Vercel Production, that the packager is the pinned binary and sees only PATH,
// and that no form of the key survives into printed errors. Keys are made at run time.
vi.mock("server-only", () => ({}));
const { drmTestSettings } = await import("@daybell/config/server");

const key = () => randomBytes(16).toString("hex");
const env = (over: Record<string, string | undefined> = {}) => ({
  DRM_TEST_PAGE_ENABLED: "true",
  DRM_TEST_KEY_ID: randomUUID(),
  DRM_TEST_CONTENT_KEY: key(),
  ...over,
});

describe("buildPlan", () => {
  it("encrypts only with the flag on, outside Production, and both keys set", () => {
    const e = env();
    const plan = buildPlan(e);
    expect(plan).toEqual({
      action: "encrypt",
      keyId: e.DRM_TEST_KEY_ID,
      keyIdHex: e.DRM_TEST_KEY_ID.replaceAll("-", ""),
      contentKeyHex: e.DRM_TEST_CONTENT_KEY,
    });
    expect(buildPlan(env({ VERCEL_ENV: "preview" })).action).toBe("encrypt");
  });

  it.each([
    ["the flag is unset", { DRM_TEST_PAGE_ENABLED: undefined }, "disabled"],
    ["the flag isn't exactly true", { DRM_TEST_PAGE_ENABLED: "1" }, "disabled"],
    ["it is Vercel Production (staging)", { VERCEL_ENV: "production" }, "production"],
    ["the key ID is missing", { DRM_TEST_KEY_ID: " " }, "missingKeys"],
    ["the content key is missing", { DRM_TEST_CONTENT_KEY: "" }, "missingKeys"],
  ])("skips when %s", (_name, over, reason) => {
    expect(buildPlan(env(over))).toEqual({ action: "skip", reason });
  });

  it("checks the flag and Production before reading any key", () => {
    expect(buildPlan(env({ DRM_TEST_PAGE_ENABLED: "", DRM_TEST_CONTENT_KEY: "bad" })).action).toBe(
      "skip",
    );
    expect(buildPlan(env({ VERCEL_ENV: "production", DRM_TEST_KEY_ID: "bad" })).action).toBe(
      "skip",
    );
  });

  it.each([
    [{ DRM_TEST_KEY_ID: "not-a-guid" }, /^DRM_TEST_KEY_ID must be a GUID$/],
    [{ DRM_TEST_CONTENT_KEY: "abcd" }, /^DRM_TEST_CONTENT_KEY must be 16 bytes as 32 hex digits$/],
  ])("fails a malformed key, naming the variable and never the value", (over, message) => {
    const value = Object.values(over)[0] as string;
    try {
      buildPlan(env(over));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toMatch(message);
      expect((err as Error).message).not.toContain(value);
    }
  });

  it("refuses a content key equal to its key ID", () => {
    const id = randomUUID();
    expect(() =>
      buildPlan(env({ DRM_TEST_KEY_ID: id, DRM_TEST_CONTENT_KEY: id.replaceAll("-", "") })),
    ).toThrow(/^DRM_TEST_CONTENT_KEY must be different from DRM_TEST_KEY_ID$/);
  });

  it("reads the key exactly as the token route does, so the clip and the license agree", () => {
    const comKey = randomBytes(32).toString("base64");
    for (const id of [
      randomUUID(),
      randomUUID().toUpperCase(),
      randomUUID().replaceAll("-", ""),
      ` ${randomUUID()} `,
    ]) {
      const e = env({ DRM_TEST_KEY_ID: id, DRM_TEST_CONTENT_KEY: key().toUpperCase() });
      const plan = buildPlan(e);
      const settings = drmTestSettings({
        ...e,
        AXINOM_COM_KEY_ID: randomUUID(),
        AXINOM_COM_KEY: comKey,
        AXINOM_LICENSE_PREFIX: "t",
      });
      if (plan.action !== "encrypt") throw new Error("expected encrypt");
      expect(plan.keyId).toBe(settings.keyId);
      expect(plan.contentKeyHex).toBe(Buffer.from(settings.contentKey).toString("hex"));
    }
    for (const bad of ["1234", "zzzzzzzz-zzzz-zzzz-zzzz-zzzzzzzzzzzz", `${randomUUID()}0`]) {
      expect(() => guidSetting("DRM_TEST_KEY_ID", bad)).toThrow();
      expect(() =>
        drmTestSettings({
          ...env({ DRM_TEST_KEY_ID: bad }),
          AXINOM_COM_KEY_ID: randomUUID(),
          AXINOM_COM_KEY: comKey,
          AXINOM_LICENSE_PREFIX: "t",
        }),
      ).toThrow(/DRM_TEST_KEY_ID must be a GUID/);
    }
  });
});

describe("scrub", () => {
  it("takes out the key as hex, GUID-dashed hex, base64 and base64url", () => {
    const hex = key();
    const bytes = Buffer.from(hex, "hex");
    const dashed = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
    const text = [
      `--keys label=:key=${hex}`,
      hex.toUpperCase(),
      dashed,
      bytes.toString("base64"),
      bytes.toString("base64").replace(/=+$/, ""),
      bytes.toString("base64url"),
    ].join("\n");
    const out = scrub(text, [hex]);
    expect(out).not.toMatch(new RegExp(hex, "i"));
    expect(out).not.toContain(dashed);
    expect(out).not.toContain(bytes.toString("base64").replace(/=+$/, ""));
    expect(out).not.toContain(bytes.toString("base64url"));
    expect(out.match(/<redacted>/g)?.length).toBe(6);
  });

  it("leaves other words alone and copes with nothing", () => {
    expect(scrub("Invalid argument: segment_template", [key()])).toBe(
      "Invalid argument: segment_template",
    );
    expect(scrub(undefined, [key(), ""])).toBe("");
  });
});

describe("removeGenerated", () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("removes an earlier build's clip and keeps the committed fallback", () => {
    dir = mkdtempSync(join(tmpdir(), "drm-out-"));
    mkdirSync(join(dir, "video"));
    for (const name of ["manifest.mpd", "master.m3u8", "video.m3u8", "fallback.jpg", "video/1.m4s"])
      writeFileSync(join(dir, name), "x");
    removeGenerated(dir);
    expect(readdirSync(dir)).toEqual(["fallback.jpg"]);
    expect(GENERATED).not.toContain("fallback.jpg");
  });
});

describe("drmTestIvHex", () => {
  it("is the key ID's own 16 bytes, so the IV is known without another setting", () => {
    expect(drmTestIvHex("00112233445566778899AABBCCDDEEFF")).toBe(
      "00112233445566778899aabbccddeeff",
    );
    const id = randomBytes(16).toString("hex");
    expect(drmTestIvHex(id)).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("the packager", () => {
  it("is chosen per platform, and only where a pinned binary exists", () => {
    expect(packagerFileName("linux", "x64")).toBe("packager-linux-x64");
    expect(packagerFileName("darwin", "arm64")).toBe("packager-osx-arm64");
    expect(packagerFileName("win32", "x64")).toBe("packager-win-x64.exe");
    expect(packagerFileName("win32", "arm64")).toBeNull();
    expect(packagerFileName("freebsd", "x64")).toBeNull();
  });

  it("runs only when its SHA-256 matches the pinned release", () => {
    const bytes = randomBytes(64);
    const pinned = PACKAGER_SHA256["packager-linux-x64"];
    expect(pinned).toBe("7a3cf35ad146fd7810b4ededab363c8a3e6121d1b2c8391f53863126186f9ee6");
    expect(() => verifyPackager("packager-linux-x64", bytes)).toThrow(
      /doesn't match the pinned Shaka Packager 3\.9\.3/,
    );
    expect(() => verifyPackager("packager-plan9", bytes)).toThrow(/no pinned SHA-256/);
    const digest = createHash("sha256").update(bytes).digest("hex");
    const original = PACKAGER_SHA256["packager-linux-x64"];
    (PACKAGER_SHA256 as Record<string, string>)["packager-linux-x64"] = digest;
    try {
      expect(() => verifyPackager("packager-linux-x64", bytes)).not.toThrow();
    } finally {
      (PACKAGER_SHA256 as Record<string, string>)["packager-linux-x64"] = original as string;
    }
  });

  it("sees PATH and nothing else from the build's environment", () => {
    expect(
      packagerEnv({ PATH: "/usr/bin", DRM_TEST_CONTENT_KEY: "k", AXINOM_COM_KEY: "c", HOME: "/r" }),
    ).toEqual({ PATH: "/usr/bin" });
    expect(packagerEnv({})).toEqual({ PATH: "" });
  });

  it("encrypts everything (cbcs, no clear lead) into a static DASH manifest and VOD HLS", () => {
    const args = packagerArgs({
      clear: "/c.mp4",
      out: "/o",
      keyId: "00112233-4455-6677-8899-aabbccddeeff",
      keyIdHex: "00112233445566778899aabbccddeeff",
      contentKeyHex: "k".repeat(32),
    });
    const argAfter = (flag: string) => args[args.indexOf(flag) + 1];
    expect(argAfter("--keys")).toBe(
      `label=:key_id=00112233445566778899aabbccddeeff:key=${"k".repeat(32)}:iv=00112233445566778899aabbccddeeff`,
    );
    expect(argAfter("--protection_scheme")).toBe("cbcs");
    expect(argAfter("--clear_lead")).toBe("0");
    expect(argAfter("--hls_key_uri")).toBe("skd://00112233-4455-6677-8899-aabbccddeeff");
    expect(argAfter("--protection_systems")).toBe("Widevine,PlayReady,FairPlay");
    expect(args).toContain("--generate_static_live_mpd");
    expect(argAfter("--hls_playlist_type")).toBe("VOD");
  });
});
