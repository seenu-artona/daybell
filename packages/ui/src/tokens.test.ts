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
    // D140: the hero's green subline and the pill tabs sit on the warm canvas.
    ["primary", "canvas"],
    // D140: icon chips and avatars put ink on every soft background.
    ["ink", "primary-soft"],
    ["ink", "lime-soft"],
    ["ink", "info-soft"],
    ["ink", "warning-soft"],
    ["ink", "danger-soft"],
    ["ink", "subtle"],
  ];
  it.each(pairs)("%s on %s passes 4.5:1", (fg, bg) => {
    expect(contrastRatio(c(fg), c(bg))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("the hero type style carries its letter spacing into the theme (D140)", () => {
    const css = buildThemeCss(tokens) as string;
    expect(css).toContain("--text-hero: 40px;");
    expect(css).toContain("--text-hero--line-height: 1.05;");
    expect(css).toContain("--text-hero--font-weight: 800;");
    expect(css).toContain("--text-hero--letter-spacing: -0.02em;");
    expect(css).toContain("--radius-xl: 24px;");
  });

  it("has the D144 list tokens in the theme", () => {
    const css = buildThemeCss(tokens) as string;
    expect(c("line-canvas")).toBe("#DAD7CF");
    expect(css).toContain("--color-line-canvas: #dad7cf;");
    expect(css).toContain("--radius-list: 20px;");
    expect(css).toContain(
      "--shadow-card: 0 1px 2px rgba(20,35,28,0.04), 0 8px 24px rgba(20,35,28,0.05);",
    );
    expect(css).toContain("--text-job-title: 28px;");
    expect(css).toContain("--text-job-title--line-height: 36px;");
    expect(css).toContain("--text-job-title--font-weight: 700;");
  });

  it("D144: the current main tab (white on ink) and inactive tabs (muted on canvas) pass 4.5:1", () => {
    expect(contrastRatio(c("on-primary"), c("ink"))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
    expect(contrastRatio(c("muted"), c("canvas"))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("the access code's label (white at 80% on ink) still passes 4.5:1", () => {
    // 80% white over ink, blended per channel.
    const ink = c("ink").slice(1);
    const blended = [0, 2, 4]
      .map((i) => Math.round(0.8 * 255 + 0.2 * Number.parseInt(ink.slice(i, i + 2), 16)))
      .map((v) => v.toString(16).padStart(2, "0"))
      .join("");
    expect(contrastRatio(`#${blended}`, c("ink"))).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
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
