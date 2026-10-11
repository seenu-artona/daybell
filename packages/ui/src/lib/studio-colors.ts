/**
 * The colours a studio can choose for its parent shop (D117: curated set only).
 * Each one carries white text at 4.5:1 or better; tokens.test.ts checks this.
 * Charcoal is the default when a studio hasn't chosen (D116): photos are the only colour.
 */
export const STUDIO_COLORS = [
  { id: "charcoal", hex: "#1c1c1e" },
  { id: "navy", hex: "#1f3a5f" },
  { id: "royal", hex: "#1d4ed8" },
  { id: "teal", hex: "#0f5e63" },
  { id: "forest", hex: "#1e5b3a" },
  { id: "crimson", hex: "#b3122e" },
  { id: "maroon", hex: "#7a1f2b" },
  { id: "clay", hex: "#a8472a" },
  { id: "plum", hex: "#5b2a4e" },
  { id: "purple", hex: "#5b3fa8" },
] as const;

export type StudioColorId = (typeof STUDIO_COLORS)[number]["id"];
export const DEFAULT_STUDIO_COLOR: StudioColorId = "charcoal";

export function studioColorHex(id: StudioColorId | null | undefined): string {
  return (STUDIO_COLORS.find((c) => c.id === id) ?? STUDIO_COLORS[0]).hex;
}
