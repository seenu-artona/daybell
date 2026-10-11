// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JS module shared with the generator script
import { buildThemeCss } from "../scripts/theme.mjs";
import { contrastRatio, MIN_TEXT_CONTRAST, readableTextOn } from "./lib/contrast";
import { STUDIO_COLORS } from "./lib/studio-colors";
import tokens from "./tokens.json";

const color = Object.fromEntries(tokens.color.tokens.map((t) => [t.name, t.value]));
const c = (name: string): string => {
  const v = color[name];
  if (!v) throw new Error(`missing colour token ${name}`);
  return v;
};

describe("tokens", () => {
  it("theme.css is up to date with tokens.json (run `pnpm --filter @daybell/ui gen`)", () => {
    const onDisk = readFileSync(new URL("./theme.css", import.meta.url), "utf8");
    expect(onDisk).toBe(buildThemeCss(tokens));
  });

  // Every text/background pairing the components use must meet WCAG 2.2 AA (D91).
  const pairs: [string, string][] = [
    ["ink", "canvas"],
    ["ink", "surface"],
    ["muted", "canvas"],
    ["muted", "surface"],
    ["muted", "lime-soft"],
    ["on-primary", "primary"],
    ["on-primary", "primary-hover"],
    ["primary", "surface"],
    ["primary-hover", "primary-soft"],
    ["ink", "lime"],
    ["muted", "subtle"],
    ["danger", "danger-soft"],
    ["on-primary", "danger"],
    ["warning-text", "warning-soft"],
    ["info", "info-soft"],
    ["on-primary", "ink"],
  ];
  it.each(pairs)("%s on %s passes 4.5:1", (fg, bg) => {
    expect(contrastRatio(c(fg), c(bg))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it.each(STUDIO_COLORS.map((c) => [c.id, c.hex]))(
    "studio colour %s carries white text",
    (_id, hex) => {
      expect(contrastRatio(hex, "#ffffff")).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    },
  );

  it("picks readable text on a studio colour", () => {
    expect(readableTextOn("#4338ca")).toBe("#ffffff");
    expect(readableTextOn("#f2b33d")).toBe("#14231c");
  });
});
