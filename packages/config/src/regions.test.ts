import { describe, expect, it } from "vitest";
import { availableRegions, isDataRegion, regionDatabase } from "./regions";

const canadaOnly = {
  us: { url: undefined, key: undefined },
  ca: { url: "https://ca.example.supabase.co", key: "sb_publishable_ca" },
};

describe("regions", () => {
  it("only offers regions whose database is configured (D122)", () => {
    expect(availableRegions(canadaOnly).map((r) => r.region)).toEqual(["ca"]);
    expect(regionDatabase("us", canadaOnly)).toBeNull();
    expect(regionDatabase("ca", canadaOnly)?.url).toBe("https://ca.example.supabase.co");
  });

  it("switches the US on when both of its variables are set", () => {
    const both = {
      ...canadaOnly,
      us: { url: "https://us.example.supabase.co", key: "sb_publishable_us" },
    };
    expect(availableRegions(both).map((r) => r.region)).toEqual(["us", "ca"]);
  });

  it("tolerates a pasted endpoint URL", () => {
    const pasted = {
      ...canadaOnly,
      ca: { url: "https://ca.example.supabase.co/rest/v1/", key: " k " },
    };
    expect(regionDatabase("ca", pasted)).toEqual({
      region: "ca",
      url: "https://ca.example.supabase.co",
      publishableKey: "k",
    });
  });

  it("recognises only known regions", () => {
    expect(isDataRegion("ca")).toBe(true);
    expect(isDataRegion("qc")).toBe(false);
    expect(isDataRegion(undefined)).toBe(false);
  });
});

import { siteUrl } from "./site";

describe("siteUrl", () => {
  it("never comes from the request; prefers SITE_URL, then Vercel's own addresses", () => {
    expect(siteUrl({ SITE_URL: "https://app.daybell.io/" })).toBe("https://app.daybell.io");
    expect(
      siteUrl({ VERCEL_ENV: "production", VERCEL_PROJECT_PRODUCTION_URL: "daybell.vercel.app" }),
    ).toBe("https://daybell.vercel.app");
    expect(siteUrl({ VERCEL_ENV: "preview", VERCEL_BRANCH_URL: "daybell-git-x.vercel.app" })).toBe(
      "https://daybell-git-x.vercel.app",
    );
    expect(siteUrl({})).toBe("http://127.0.0.1:3000");
  });
});
