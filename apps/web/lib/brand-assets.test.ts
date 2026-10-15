import { readFileSync } from "node:fs";
import { join } from "node:path";
import { RIDGE_BOTTOM_ARC, RIDGE_TOP_ARC } from "@daybell/ui";
import tokens from "@daybell/ui/tokens.json";
import { describe, expect, it } from "vitest";

// The interim Ridge mark (D155; ADR 0031): the favicon and the SVG files draw the same arcs as <RidgeMark> in the
// brand's token colours, so the files can't drift from the design system.
const web = join(__dirname, "..");
const read = (...path: string[]) => readFileSync(join(web, ...path), "utf8");
const token = (name: string): string => {
  const found = tokens.color.tokens.find((t) => t.name === name);
  if (!found) throw new Error(`missing colour token ${name}`);
  return found.value.toUpperCase();
};

function strokes(svg: string): [string, string][] {
  return [...svg.matchAll(/<path d="([^"]+)"[^>]*stroke="(#[0-9A-Fa-f]{6})"/g)].map((m) => [
    m[1] as string,
    (m[2] as string).toUpperCase(),
  ]);
}

describe("the Ridge mark's files (D155)", () => {
  it.each([
    ["the favicon", ["app", "icon.svg"], "primary", "ink"],
    ["the light-background file", ["public", "brand", "silverback-ridge.svg"], "primary", "ink"],
    [
      "the dark-background file",
      ["public", "brand", "silverback-ridge-dark.svg"],
      "lime",
      "on-primary",
    ],
  ])("%s draws the two arcs in the brand's token colours", (_, path, top, bottom) => {
    const svg = read(...(path as string[]));
    expect(strokes(svg)).toEqual([
      [RIDGE_TOP_ARC, token(top as string)],
      [RIDGE_BOTTOM_ARC, token(bottom as string)],
    ]);
    expect(svg).toContain('aria-label="Silverback"');
    expect(svg).not.toMatch(/daybell/i);
  });
});

describe("the parent shop's favicon (D62)", () => {
  it("is a plain ink square: no Ridge mark, no letters", () => {
    const svg = read("app", "shop", "icon.svg");
    expect(svg).toMatch(new RegExp(`<rect [^>]*fill="${token("ink")}"`, "i"));
    expect(svg).not.toMatch(/<path|<text|aria-label/);
    expect(svg).not.toMatch(/silverback|daybell/i);
  });
});
