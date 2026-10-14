import { describe, expect, it } from "vitest";
import { greetingFor } from "./greeting";

describe("greetingFor (D146)", () => {
  it("says morning from 5 to 11, afternoon from 12 to 17, evening otherwise", () => {
    expect([0, 4, 5, 11, 12, 17, 18, 23].map(greetingFor)).toEqual([
      "evening",
      "evening",
      "morning",
      "morning",
      "afternoon",
      "afternoon",
      "evening",
      "evening",
    ]);
  });
});
