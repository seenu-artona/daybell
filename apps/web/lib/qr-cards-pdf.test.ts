import { cardQrPayload } from "@daybell/core";
import { describe, expect, it, vi } from "vitest";

// The QR card PDF (D32, D138; ADR 0015): four cards per page, the embedded font only, no personal data in the
// metadata, and "?" counted for characters the font lacks. Rendered uncompressed so the PDF's structure can be read.
vi.mock("server-only", () => ({}));
const { renderQrCardsPdf } = await import("./qr-cards-pdf");

const TEXTS = {
  studioName: "North Peak Photo",
  groupLine: (name: string) => `Class: ${name}`,
  groupLabel: "Class",
  nameLabel: "Name",
  accessCodeLabel: "Access code",
  instructions: "Go to shop.example.test, enter your code",
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
