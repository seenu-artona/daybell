import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import enCA from "../messages/en-CA.json";
import enUS from "../messages/en-US.json";

// Words live in the locale files (D96). English is the same in the US and Canada at launch, so both files must have
// the same keys, and every validation key the API can return must have words.
function keys(node: unknown, prefix = ""): string[] {
  if (typeof node !== "object" || node === null) return [prefix];
  return Object.entries(node).flatMap(([k, v]) => keys(v, prefix ? `${prefix}.${k}` : k));
}

describe("locale files", () => {
  it("en-US and en-CA have the same keys", () => {
    expect(keys(enCA).sort()).toEqual(keys(enUS).sort());
  });

  it("have words for every validation key the API uses", () => {
    const schemas = readFileSync(
      join(__dirname, "..", "..", "..", "packages", "api", "src", "schemas.ts"),
      "utf8",
    );
    const used = new Set([...schemas.matchAll(/"validation\.(\w+)"/g)].map((m) => m[1] as string));
    expect(used.size).toBeGreaterThan(10);
    for (const key of used) expect(Object.keys(enUS.validation), key).toContain(key);
  });
});
