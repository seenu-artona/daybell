import { describe, expect, it } from "vitest";
import { safeNextClient } from "./safe-next";

describe("safeNext", () => {
  it("keeps our own paths", () => {
    expect(safeNextClient("/app")).toBe("/app");
    expect(safeNextClient("/invite/abc123")).toBe("/invite/abc123");
  });

  it("refuses anything that could leave Daybell", () => {
    for (const bad of [
      "https://evil.example",
      "//evil.example",
      "/\\evil.example",
      "javascript:alert(1)",
      "",
      null,
    ]) {
      expect(safeNextClient(bad)).toBe("/app");
    }
  });
});
