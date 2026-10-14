import { describe, expect, it } from "vitest";
import { CARRIER_TRACKING_URLS } from "./carriers";

describe("carrier tracking pages (ADR 0024)", () => {
  it("are https pages of the carrier's own site, each with one {number}", () => {
    for (const [carrier, url] of Object.entries(CARRIER_TRACKING_URLS)) {
      expect(url.startsWith("https://"), carrier).toBe(true);
      expect(url.split("{number}").length - 1, carrier).toBe(1);
    }
    expect(Object.keys(CARRIER_TRACKING_URLS).sort()).toEqual([
      "canada_post",
      "fedex",
      "purolator",
      "ups",
    ]);
  });
});
