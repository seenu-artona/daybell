import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The Lambda zip installs sharp from lambda/package-lock.json with `npm ci --ignore-scripts` (review S4): the same
// sharp the pipeline is tested with, every package locked with an integrity hash.
const here = join(__dirname, "..");
const json = (path: string) => JSON.parse(readFileSync(join(here, path), "utf8"));

describe("the Lambda's locked install", () => {
  it("pins the pipeline's sharp, with integrity for every package", () => {
    const pinned = json("../../packages/image-pipeline/package.json").dependencies.sharp;
    expect(json("lambda/package.json").dependencies).toEqual({ sharp: pinned });
    const packages = json("lambda/package-lock.json").packages as Record<
      string,
      { version?: string; integrity?: string }
    >;
    expect(packages["node_modules/sharp"]?.version).toBe(pinned);
    expect(packages["node_modules/@img/sharp-linux-arm64"]?.version).toBe(pinned);
    for (const [name, p] of Object.entries(packages))
      if (name) expect(p.integrity, name).toMatch(/^sha512-/);
  });
});
