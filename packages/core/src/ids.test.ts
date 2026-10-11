import { describe, expect, it } from "vitest";
import { isUuid, studioId } from "./ids";

describe("ids", () => {
  it("accepts a v4 UUID", () => {
    expect(isUuid("3f6c1a52-8d3e-4b6a-9c1f-2e7d5a9b0c11")).toBe(true);
  });

  it("rejects anything else", () => {
    expect(isUuid("studio-1")).toBe(false);
    expect(() => studioId("")).toThrow("Studio ID must be a UUID");
  });
});
