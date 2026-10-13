import { describe, expect, it } from "vitest";
import { shopUrl, siteUrl } from "./site";

describe("shopUrl (QR cards; ADR 0015)", () => {
  it("is SHOP_URL when set, without trailing slashes", () => {
    expect(shopUrl({ SHOP_URL: " https://shop.daybell.com/ " })).toBe("https://shop.daybell.com");
  });

  it("falls back to this deployment's /shop, so staging prints its Vercel address (ADR 0022)", () => {
    const env = { VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "daybell-git-main.vercel.app" };
    expect(shopUrl(env)).toBe("https://daybell-git-main.vercel.app/shop");
    expect(shopUrl({})).toBe(`${siteUrl({})}/shop`);
    expect(shopUrl({ SHOP_URL: "  " })).toBe(`${siteUrl({})}/shop`);
    expect(shopUrl({ SITE_URL: "https://staging.daybell.com/" })).toBe(
      "https://staging.daybell.com/shop",
    );
  });

  it("refuses an address that isn't http(s), naming the variable and never the value", () => {
    expect(() => shopUrl({ SHOP_URL: "shop.daybell.com" })).toThrow(
      /^SHOP_URL must be an http\(s\) address$/,
    );
    expect(() => shopUrl({ SHOP_URL: "javascript:alert(1)" })).toThrow(/^SHOP_URL must be/);
  });
});
