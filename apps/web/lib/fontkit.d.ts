// The small part of fontkit (a pdfkit dependency, pinned in package.json) the QR card PDF uses: which characters a
// font can draw. fontkit ships no types.
declare module "fontkit" {
  export interface Font {
    hasGlyphForCodePoint(codePoint: number): boolean;
  }
  export function create(buffer: Uint8Array, postscriptName?: string): Font;
}
