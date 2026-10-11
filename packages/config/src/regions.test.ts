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

  it("recognises only known regions", () => {
    expect(isDataRegion("ca")).toBe(true);
    expect(isDataRegion("qc")).toBe(false);
    expect(isDataRegion(undefined)).toBe(false);
  });
});
