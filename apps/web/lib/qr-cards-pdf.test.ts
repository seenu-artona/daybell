import { CARD_LAYOUT, cardQrPayload } from "@daybell/core";
import { describe, expect, it, vi } from "vitest";

// The QR card PDF (D32, D138; ADR 0015): four cards per page, the embedded font only, no personal data in the
// metadata, and "?" counted for characters the font lacks. Rendered uncompressed so the PDF's structure can be read.
vi.mock("server-only", () => ({}));
const { renderQrCardsPdf } = await import("./qr-cards-pdf");

const TEXTS = {
  title: "QR cards",
  studioName: "North Peak Photo",
  groupLine: (name: string) => `Class: ${name}`,
  groupLabel: "Class",
  nameLabel: "Name",
  accessCodeLabel: "Access code",
  instructions: "Go to shop.example.test, enter your code",
  foldBack: "Fold back before picture day",
};

const card = (firstName: string, lastName: string, group: string | null, n: number) => ({
  child: { firstName, lastName, group },
  qrPayload: cardQrPayload(String(n).padStart(20, "0")),
  accessCode: "K7QM-4XPA",
});
const blank = (n: number) => ({
  child: null,
  qrPayload: cardQrPayload(String(n).padStart(20, "1")),
  accessCode: "JKMN-PQRS",
});

const render = (cards: Parameters<typeof renderQrCardsPdf>[0]) =>
  renderQrCardsPdf(cards, TEXTS, { compress: false });

/**
 * Each run of text on the first page: its font size and its baseline, measured from the page's top (pdfkit writes
 * "x y Tm" from the bottom). The first card's top-left corner is the page's.
 */
function textRuns(pdf: Buffer): { size: number; baseline: number }[] {
  const runs: { size: number; baseline: number }[] = [];
  let y = 0;
  for (const line of pdf.toString("latin1").split("\n")) {
    const tm = line.match(/^1 0 0 1 [\d.]+ ([\d.]+) Tm$/);
    if (tm) y = Number(tm[1]);
    const tf = line.match(/^\/F\d+ ([\d.]+) Tf$/);
    if (tf) runs.push({ size: Number(tf[1]), baseline: CARD_LAYOUT.page.height - y });
  }
  return runs;
}

/** Page objects ("/Type /Page", not "/Type /Pages"). */
const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;

describe("renderQrCardsPdf", () => {
  it("puts four cards on each US Letter page", async () => {
    const four = await render([1, 2, 3, 4].map((n) => card("Maya", "Johnson", "Room 4", n)));
    expect(four.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(four.pdf)).toBe(1);
    expect(four.pdf.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
    const five = await render([...[1, 2, 3, 4].map((n) => card("A", "B", null, n)), blank(5)]);
    expect(pages(five.pdf)).toBe(2);
  });

  it("embeds Plus Jakarta Sans and never a standard PDF font", async () => {
    const { pdf } = await render([card("Zoë", "Ñúñez", "Room 4", 1), blank(2)]);
    const text = pdf.toString("latin1");
    expect(text).toContain("/FontFile2");
    expect(text).toMatch(/PlusJakartaSans-Bold/);
    expect(text).not.toMatch(/\/BaseFont \/(Helvetica|Times|Courier)/);
  });

  it("keeps names and codes out of the metadata", async () => {
    const { pdf } = await render([card("Maya", "Johnson", "Room 4", 1)]);
    const text = pdf.toString("latin1");
    expect(text).toMatch(/\/Title \d+ 0 R/);
    expect(text).toContain("(QR cards)");
    expect(text).not.toContain("Maya");
    expect(text).not.toContain("Johnson");
    expect(text).not.toContain("K7QM");
  });

  it("counts cards with characters the font can't print (Latin and accents only)", async () => {
    const latin = await render([card("Zoë", "Ñúñez-O'Brien", "Salle 2", 1)]);
    expect(latin.replacedCards).toBe(0);
    const other = await render([
      card("李", "雷", "Room 4", 1),
      card("Maya", "Johnson", "Room 4", 2),
      card("Ана", "Петрова", null, 3),
    ]);
    expect(other.replacedCards).toBe(2);
  });

  it("draws the QR symbol (quiet zone excluded) at least 1.75 inches square", async () => {
    const { pdf } = await render([card("Maya", "Johnson", "Room 4", 1)]);
    // The QR is the only thing drawn with rectangles: "x y w h re".
    const rects = [
      ...pdf.toString("latin1").matchAll(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) (-?[\d.]+) re/g),
    ].map((m) => m.slice(1, 5).map(Number) as [number, number, number, number]);
    expect(rects.length).toBeGreaterThan(20);
    const left = Math.min(...rects.map(([x]) => x));
    const right = Math.max(...rects.map(([x, , w]) => x + w));
    const ys = rects.flatMap(([, y, , h]) => [y, y + h]);
    const width = right - left;
    const height = Math.max(...ys) - Math.min(...ys);
    expect(width).toBeGreaterThanOrEqual(1.75 * 72);
    expect(height).toBeCloseTo(width, 3);
  });

  it("prints only the name, class and QR above the fold; the access code is on the fold-back tab (answer 11)", async () => {
    const fold = CARD_LAYOUT.at.fold;
    for (const one of [card("Maya", "Johnson", "Room 4", 1), blank(2)]) {
      const { pdf } = await render([one]);
      const runs = textRuns(pdf);
      // Name (or its line) and class (or its line): nothing else is printed on the photographed front.
      expect(runs.filter((r) => r.baseline < fold)).toHaveLength(2);
      // The access code (the only text at its size) is below the fold, with the label, studio and instructions.
      const code = runs.filter((r) => r.size === CARD_LAYOUT.code.size);
      expect(code).toHaveLength(1);
      expect(code[0]?.baseline).toBeGreaterThan(fold + CARD_LAYOUT.code.size);
      expect(runs.filter((r) => r.baseline > fold)).toHaveLength(5);
      // The fold line is dashed, unlike the cut lines' longer dashes.
      const text = pdf.toString("latin1");
      expect(text).toContain("[2 3] 0 d");
      expect(text).toContain("[4 4] 0 d");
      // The QR (the rectangles) is wholly above the fold.
      const bottoms = [...text.matchAll(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) (-?[\d.]+) re/g)].map(
        (m) => Number(m[2]) + Number(m[4]),
      );
      expect(Math.max(...bottoms)).toBeLessThan(fold);
    }
  });

  it("fits the longest names the roster allows", async () => {
    const { pdf } = await render([card("W".repeat(60), "M".repeat(60), "R".repeat(60), 1)]);
    expect(pages(pdf)).toBe(1);
  });

  it("prints 400 cards (100 pages) quickly", async () => {
    const started = performance.now();
    const many = Array.from({ length: 400 }, (_, n) => card("Maya", "Johnson", "Room 4", n));
    const { pdf } = await renderQrCardsPdf(many, TEXTS);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
