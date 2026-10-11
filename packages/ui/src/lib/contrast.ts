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
