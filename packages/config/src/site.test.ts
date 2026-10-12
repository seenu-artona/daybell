import { describe, expect, it } from "vitest";
import { shopUrl, siteUrl } from "./site";

describe("shopUrl (QR cards; ADR 0015)", () => {
  it("is SHOP_URL when set, without trailing slashes", () => {
    expect(shopUrl({ SHOP_URL: " https://shop.daybell.com/ " })).toBe("https://shop.daybell.com");
  });

  it("falls back to this deployment's address, so staging prints its Vercel address", () => {
    const env = { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "daybell-git-main.vercel.app" };
    expect(shopUrl(env)).toBe("https://daybell-git-main.vercel.app");
    expect(shopUrl({})).toBe(siteUrl({}));
    expect(shopUrl({ SHOP_URL: "  " })).toBe(siteUrl({}));
  });

  it("refuses an address that isn't http(s), naming the variable and never the value", () => {
    expect(() => shopUrl({ SHOP_URL: "shop.daybell.com" })).toThrow(
      /^SHOP_URL must be an http\(s\) address$/,
    );
    expect(() => shopUrl({ SHOP_URL: "javascript:alert(1)" })).toThrow(/^SHOP_URL must be/);
  });
});
