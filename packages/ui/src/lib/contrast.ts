/** WCAG 2.x contrast helpers. Used to check tokens and to keep a studio's brand colour readable. */
function channel(c: number): number {
  const s = c / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Returns "#rrggbb" (lower case) for "#rgb" or "#rrggbb", or null for anything else. Never throws. */
export function normalizeHex(value: string | null | undefined): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((value ?? "").trim());
  if (!m?.[1]) return null;
  const h = m[1].length === 3 ? [...m[1]].map((c) => c + c).join("") : m[1];
  return `#${h.toLowerCase()}`;
}

function rgb(hex: string): [number, number, number] {
  const n = Number.parseInt((normalizeHex(hex) ?? "#000000").slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

export function luminance(hex: string): number {
  const [r, g, b] = rgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

/** AA for normal text. */
export const MIN_TEXT_CONTRAST = 4.5;
/** AA for focus rings, borders and other non-text UI (WCAG 1.4.11). */
export const MIN_UI_CONTRAST = 3;

/** Picks white or ink text for a background, whichever reads better. */
export function readableTextOn(background: string, light = "#ffffff", dark = "#14231c"): string {
  return contrastRatio(background, light) >= contrastRatio(background, dark) ? light : dark;
}

function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = rgb(a);
  const [br, bg, bb] = rgb(b);
  const c = (x: number, y: number) =>
    Math.round(x + (y - x) * t)
      .toString(16)
      .padStart(2, "0");
  return `#${c(ar, br)}${c(ag, bg)}${c(ab, bb)}`;
}

/**
 * A version of the brand colour usable for focus rings and selected borders: darkened toward ink
 * until it reaches 3:1 against the surface, so light brand colours (yellow, pastel) stay visible.
 */
export function uiColorOn(brand: string, surface = "#ffffff", ink = "#14231c"): string {
  let colour = normalizeHex(brand) ?? ink;
  for (let t = 0.1; contrastRatio(colour, surface) < MIN_UI_CONTRAST && t <= 1; t += 0.1) {
    colour = mix(brand, ink, t);
  }
  return colour;
}

/** The parent shop's colour until a studio picks its own (D116). */
export const DEFAULT_SHOP_ACCENT = "#1c1c1e";
const INK = "#14231c";

export interface ShopAccent {
  /** Buttons, the bag's count, selected tabs. */
  accent: string;
  /** Text and icons on the accent: white or ink, whichever reads better (4.5:1 or more). */
  onAccent: string;
  /** Focus rings, selected radios and pose rings: 3:1 or more against white (WCAG 1.4.11). */
  ring: string;
}

/**
 * The shop's colours from a studio's colour (D116, D117; Claude's call 7: everyone is charcoal in Phase 1, and this is
 * kept for when studios pick one). A colour that is unreadable with both white and ink text, or not a colour at all,
 * falls back to charcoal; a pale one keeps its buttons but rings and selected marks use ink instead.
 */
export function shopAccent(brand: string | null | undefined): ShopAccent {
  const hex = normalizeHex(brand);
  const readable =
    hex !== null &&
    Math.max(contrastRatio(hex, "#ffffff"), contrastRatio(hex, INK)) >= MIN_TEXT_CONTRAST;
  const accent = readable ? hex : DEFAULT_SHOP_ACCENT;
  return {
    accent,
    onAccent: readableTextOn(accent),
    ring: contrastRatio(accent, "#ffffff") >= MIN_UI_CONTRAST ? accent : INK,
  };
}

/** The CSS variables the shop's components read (the theme's studio slot), for a studio's colour. */
export function shopAccentVariables(brand: string | null | undefined): Record<string, string> {
  const { accent, onAccent, ring } = shopAccent(brand);
  return {
    "--color-studio": accent,
    "--color-on-studio": onAccent,
    "--color-studio-ring": ring,
  };
}
