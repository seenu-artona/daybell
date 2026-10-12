import { describe, expect, it, vi } from "vitest";
import {
  assertFunctionRegion,
  assertPayoutFunctionRegion,
  assertPayoutRegion,
  assertStorageRegion,
} from "./region-guard";

describe("assertFunctionRegion (D113; ADR 0015, 0016)", () => {
  it("refuses a Canadian studio's work outside Montréal, logging region names only", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertFunctionRegion("ca", { VERCEL_REGION: "iad1" })).toThrow(
      expect.objectContaining({ code: "region_unavailable" }),
    );
    expect(errors).toHaveBeenCalledWith("wrong_function_region", "ca", "iad1");
    errors.mockRestore();
  });
  it("allows Montréal, and anywhere when not on Vercel (local, CI)", () => {
    expect(() => assertFunctionRegion("ca", { VERCEL_REGION: "yul1" })).not.toThrow();
    expect(() => assertFunctionRegion("ca", {})).not.toThrow();
  });
  it("has no rule for the US yet", () => {
    expect(() => assertFunctionRegion("us", { VERCEL_REGION: "yul1" })).not.toThrow();
  });
});

describe("assertStorageRegion (Seenu, answer 8)", () => {
  it("stores Canadian photos and refuses US ones until R2 exists", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertStorageRegion("ca")).not.toThrow();
    expect(() => assertStorageRegion("us")).toThrow(
      expect.objectContaining({ code: "region_unavailable" }),
    );
    errors.mockRestore();
  });
});

describe("assertPayoutRegion (Seenu, Q3; ADR 0020)", () => {
  it("offers payouts to Canadian studios and refuses US ones for now", () => {
    expect(() => assertPayoutRegion("ca")).not.toThrow();
    expect(() => assertPayoutRegion("us")).toThrow(
      expect.objectContaining({ code: "region_unavailable" }),
    );
  });
});

describe("assertPayoutFunctionRegion (D113; security review M1)", () => {
  it("refuses payout work outside the payout regions' function regions (Montréal in Phase 1)", () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => assertPayoutFunctionRegion({ VERCEL_REGION: "iad1" })).toThrow(
      expect.objectContaining({ code: "region_unavailable" }),
    );
    expect(errors).toHaveBeenCalledWith("wrong_function_region", "payouts", "iad1");
    errors.mockRestore();
  });
  it("allows Montréal, and anywhere when not on Vercel (local, CI)", () => {
    expect(() => assertPayoutFunctionRegion({ VERCEL_REGION: "yul1" })).not.toThrow();
    expect(() => assertPayoutFunctionRegion({})).not.toThrow();
  });
});
