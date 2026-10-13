import { describe, expect, it } from "vitest";
import {
  contrastRatio,
  DEFAULT_SHOP_ACCENT,
  MIN_TEXT_CONTRAST,
  MIN_UI_CONTRAST,
  shopAccent,
  shopAccentVariables,
} from "./contrast";

describe("shopAccent (D116; Claude's call 7)", () => {
  it("is charcoal with white text when the studio has no colour", () => {
    for (const brand of [null, undefined, "", "not a colour", "#12"])
      expect(shopAccent(brand)).toEqual({
        accent: DEFAULT_SHOP_ACCENT,
        onAccent: "#ffffff",
        ring: DEFAULT_SHOP_ACCENT,
      });
  });

  it("keeps a dark colour, with white text and itself as the ring", () => {
    expect(shopAccent("#1F3A5F")).toEqual({
      accent: "#1f3a5f",
      onAccent: "#ffffff",
      ring: "#1f3a5f",
    });
  });

  it("gives a pale yellow ink text, and an ink ring (WCAG 1.4.11)", () => {
    const pale = shopAccent("#FFE66D");
    expect(pale.accent).toBe("#ffe66d");
    expect(pale.onAccent).toBe("#14231c");
    expect(pale.ring).toBe("#14231c");
    expect(contrastRatio(pale.accent, pale.onAccent)).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
  });

  it("falls back to charcoal for a mid grey nothing reads well on", () => {
    // #777777: 4.48:1 with white and about 3.6:1 with ink.
    expect(contrastRatio("#777777", "#ffffff")).toBeLessThan(MIN_TEXT_CONTRAST);
    expect(shopAccent("#777777").accent).toBe(DEFAULT_SHOP_ACCENT);
  });

  it("always reads: text 4.5:1 on the accent, the ring 3:1 on white", () => {
    for (const brand of [
      "#ff0000",
      "#00ff00",
      "#0000ff",
      "#ffffff",
      "#000000",
      "#b8f05a",
      "#5b3fa8",
    ]) {
      const { accent, onAccent, ring } = shopAccent(brand);
      expect(contrastRatio(accent, onAccent), brand).toBeGreaterThanOrEqual(MIN_TEXT_CONTRAST);
      expect(contrastRatio(ring, "#ffffff"), brand).toBeGreaterThanOrEqual(MIN_UI_CONTRAST);
    }
  });

  it("sets the theme's studio slot", () => {
    expect(shopAccentVariables(null)).toEqual({
      "--color-studio": "#1c1c1e",
      "--color-on-studio": "#ffffff",
      "--color-studio-ring": "#1c1c1e",
    });
  });
});
