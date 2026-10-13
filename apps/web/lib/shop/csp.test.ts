import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";
import { newNonce, shopContentSecurityPolicy, shopImageSources } from "./csp";

vi.mock("@daybell/config", async (original) => ({
  ...(await original<typeof import("@daybell/config")>()),
  regionDatabase: () => null,
}));
const { proxy } = await import("../../proxy");

// The shop's Content-Security-Policy (security review L2; ADR 0022 §5): scripts only from this site with the page's
// nonce, images only from this site and Canada's bucket in ca-central-1 (D113), never framed, no forms elsewhere.
describe("the shop's Content-Security-Policy", () => {
  it("allows this site's nonce'd scripts, and images from Canada's bucket only", () => {
    const sources = shopImageSources({
      STORAGE_DRIVER: "s3",
      PHOTO_BUCKET_CA: "daybell-ca-photos",
    });
    expect(sources).toEqual(["https://daybell-ca-photos.s3.ca-central-1.amazonaws.com"]);
    const csp = shopContentSecurityPolicy("abc", { imageSources: sources });
    expect(csp.split("; ")).toEqual([
      "default-src 'self'",
      "script-src 'self' 'nonce-abc' 'strict-dynamic'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' blob: data: https://daybell-ca-photos.s3.ca-central-1.amazonaws.com",
      "font-src 'self'",
      "connect-src 'self'",
      "object-src 'none'",
      "frame-ancestors 'none'",
      "base-uri 'none'",
      "form-action 'self'",
    ]);
    expect(shopImageSources({ STORAGE_DRIVER: "local" })).toEqual([]);
    expect(shopImageSources({ STORAGE_DRIVER: "s3", PHOTO_BUCKET_CA: "x/evil.example" })).toEqual(
      [],
    );
    expect(shopContentSecurityPolicy("n", { dev: true, imageSources: [] })).toContain(
      "script-src 'self' 'nonce-n' 'strict-dynamic' 'unsafe-eval'",
    );
  });

  it("is a fresh nonce for every shop page, on the request (for Next's scripts) and the response", async () => {
    const res = await proxy(new NextRequest("https://shop.example.test/shop/bag"));
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toMatch(/script-src 'self' 'nonce-[A-Za-z0-9+/=]{24}' 'strict-dynamic'/);
    expect(res.headers.get("x-middleware-request-content-security-policy")).toBe(csp);
    const again = await proxy(new NextRequest("https://shop.example.test/shop"));
    expect(again.headers.get("content-security-policy")).not.toBe(csp);
    expect(newNonce()).not.toBe(newNonce());
  });

  it("leaves the studio app's pages alone", async () => {
    const res = await proxy(new NextRequest("https://app.example.test/pricing"));
    expect(res.headers.get("content-security-policy")).toBeNull();
  });
});
