import { describe, expect, it } from "vitest";
import { apiText } from "./api-text";

const text = apiText(
  (key) => `v:${key}`,
  (key) => `e:${key}`,
);

describe("apiText", () => {
  it("translates validation keys, and anything else as a generic invalid value", () => {
    expect(text.field("validation.firstName")).toBe("v:firstName");
    expect(text.field("Too long")).toBe("v:invalid");
    expect(text.field(undefined)).toBeUndefined();
  });

  it("translates known error codes and falls back to internal", () => {
    expect(text.error("conflict")).toBe("e:conflict");
    expect(text.error("made_up")).toBe("e:internal");
    expect(text.error("toString")).toBe("e:internal");
  });
});
