import { backCardOrigin, CARD_LAYOUT, cardOrigin, cardQrPayload } from "@daybell/core";
import { describe, expect, it, vi } from "vitest";

// The QR card PDF (D32, D138; ADR 0015, 0018): four cards per sheet, printed double-sided (a front page, then a back
// page whose columns are mirrored); the access code only ever on a back page; the embedded font only, no personal data
// in the metadata, and "?" counted for characters the font lacks. Rendered uncompressed so the PDF's structure can be
// read, and its text decoded through the fonts' ToUnicode maps.
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
  blankCard: "Blank card",
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

/** A run of text: what it says, its font size, its left edge and its baseline from the page's top. */
interface Run {
  text: string;
  size: number;
  x: number;
  baseline: number;
}
/** A page's text runs and the QR's rectangles (x, top, width, height; from the page's top). */
interface Page {
  runs: Run[];
  rects: { x: number; top: number; width: number; height: number }[];
}

/**
 * Reads each page of an uncompressed pdfkit PDF, in order: its text (decoded through the fonts' ToUnicode maps; pdfkit
 * writes "x y Tm", "/Fn size Tf" and "[<glyphs> kerning …] TJ" from the page's bottom) and its rectangles ("x y w h re").
 */
function readPdf(pdf: Buffer): Page[] {
  const text = pdf.toString("latin1");
  const objects = new Map<string, string>();
  for (const m of text.matchAll(/(\d+) 0 obj\n([\s\S]*?)\nendobj/g))
    objects.set(m[1] as string, m[2] as string);
  const object = (id: string) => {
    const body = objects.get(id);
    if (body === undefined) throw new Error(`No object ${id}`);
    return body;
  };
  const fonts = new Map<string, string[]>();
  const font = (name: string, resources: string) => {
    const known = fonts.get(name);
    if (known) return known;
    const id = resources.match(new RegExp(`/${name} (\\d+) 0 R`))?.[1] as string;
    const cmap = object(object(id).match(/\/ToUnicode (\d+) 0 R/)?.[1] as string);
    const chars: string[] = [];
    for (const range of cmap.matchAll(/<([0-9a-f]{4})> <[0-9a-f]{4}> \[([^\]]*)\]/g)) {
      let glyph = Number.parseInt(range[1] as string, 16);
      for (const u of (range[2] as string).matchAll(/<([0-9a-f]+)>/g))
        chars[glyph++] = String.fromCodePoint(Number.parseInt(u[1] as string, 16));
    }
    fonts.set(name, chars);
    return chars;
  };
  const kids = object(text.match(/(\d+) 0 obj\n<<\n\/Type \/Pages/)?.[1] as string);
  const pageIds = [...(kids.match(/\/Kids \[([^\]]*)\]/)?.[1] ?? "").matchAll(/(\d+) 0 R/g)].map(
    (m) => m[1] as string,
  );
  const height = CARD_LAYOUT.page.height;
  return pageIds.map((id) => {
    const page = object(id);
    const content = object(page.match(/\/Contents (\d+) 0 R/)?.[1] as string);
    const resources = object(page.match(/\/Resources (\d+) 0 R/)?.[1] as string);
    const runs: Run[] = [];
    const rects: Page["rects"] = [];
    let at = { x: 0, y: 0 };
    let current = { chars: [] as string[], size: 0 };
    for (const line of content.split("\n")) {
      const tm = line.match(/^1 0 0 1 (-?[\d.]+) (-?[\d.]+) Tm$/);
      if (tm) at = { x: Number(tm[1]), y: Number(tm[2]) };
      const tf = line.match(/^\/(F\d+) ([\d.]+) Tf$/);
      if (tf) current = { chars: font(tf[1] as string, resources), size: Number(tf[2]) };
      if (line.endsWith(" TJ")) {
        const glyphs = [...line.matchAll(/<([0-9a-f]+)>/g)].flatMap(
          (m) =>
            (m[1] as string)
              .match(/.{4}/g)
              ?.map((g) => current.chars[Number.parseInt(g, 16)] ?? "?") ?? [],
        );
        runs.push({ text: glyphs.join(""), size: current.size, x: at.x, baseline: height - at.y });
      }
      for (const r of line.matchAll(/(-?[\d.]+) (-?[\d.]+) ([\d.]+) (-?[\d.]+) re/g)) {
        const [x, y, w, h] = r.slice(1, 5).map(Number) as [number, number, number, number];
        // pdfkit draws shapes from the page's top (its "1 0 0 -1 0 792 cm").
        rects.push({ x, top: Math.min(y, y + h), width: w, height: Math.abs(h) });
      }
    }
    return { runs, rects };
  });
}

/** Page objects ("/Type /Page", not "/Type /Pages"). */
const pages = (pdf: Buffer) => pdf.toString("latin1").match(/\/Type \/Page(?!s)/g)?.length ?? 0;

/** Which of the page's four card slots, by the top-left corner, a point is in (column, row). */
const slot = (x: number, y: number) => ({
  column: Math.floor(x / CARD_LAYOUT.card.width),
  row: Math.floor(y / CARD_LAYOUT.card.height),
});

describe("renderQrCardsPdf", () => {
  it("puts four cards on each US Letter sheet: a front page, then a back page", async () => {
    const four = await render([1, 2, 3, 4].map((n) => card("Maya", "Johnson", "Room 4", n)));
    expect(four.pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages(four.pdf)).toBe(2);
    expect(four.pdf.toString("latin1")).toContain("/MediaBox [0 0 612 792]");
    const five = await render([...[1, 2, 3, 4].map((n) => card("A", "B", null, n)), blank(5)]);
    expect(pages(five.pdf)).toBe(4);
    // One card (the child panel's print) is one sheet: two pages.
    expect(pages((await render([card("Maya", "Johnson", "Room 4", 1)])).pdf)).toBe(2);
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
    const [front, back] = readPdf((await render([card("Maya", "Johnson", "Room 4", 1)])).pdf);
    // The QR is the only thing drawn with rectangles, and only on the front.
    expect(back?.rects).toEqual([]);
    const rects = front?.rects ?? [];
    expect(rects.length).toBeGreaterThan(20);
    const left = Math.min(...rects.map((r) => r.x));
    const right = Math.max(...rects.map((r) => r.x + r.width));
    const top = Math.min(...rects.map((r) => r.top));
    const bottom = Math.max(...rects.map((r) => r.top + r.height));
    expect(right - left).toBeGreaterThanOrEqual(1.75 * 72);
    expect(bottom - top).toBeCloseTo(right - left, 3);
  });

  it("prints the studio, name, class and QR on the front, and the access code only on the back", async () => {
    const [front, back] = readPdf((await render([card("Maya", "Johnson", "Room 4", 1)])).pdf);
    // The match mark (the card ID's last four characters) ends both sides; the back names whose card it is.
    expect(front?.runs.map((r) => r.text)).toEqual([
      "North Peak Photo",
      "Maya Johnson",
      "Class: Room 4",
      "0001",
    ]);
    expect(back?.runs.map((r) => r.text)).toEqual([
      "North Peak Photo",
      "Maya J.",
      "Class: Room 4",
      "Access code",
      "K7QM-4XPA",
      "Go to shop.example.test, enter your code",
      "0001",
    ]);
    // Small, above the code.
    const owner = back?.runs.find((r) => r.text === "Maya J.");
    expect(owner?.size).toBeLessThan(CARD_LAYOUT.code.size / 2);
    expect(owner?.baseline).toBeLessThan(
      back?.runs.find((r) => r.text === "K7QM-4XPA")?.baseline ?? 0,
    );
    // Large: the code is the biggest text on the card.
    const code = back?.runs.find((r) => r.text === "K7QM-4XPA");
    expect(code?.size).toBe(CARD_LAYOUT.code.size);
    expect(Math.max(...(back?.runs ?? []).map((r) => r.size))).toBe(CARD_LAYOUT.code.size);
    // No fold line or tab: the only dashes are the cut lines'.
    const text = (await render([card("Maya", "Johnson", "Room 4", 1)])).pdf.toString("latin1");
    expect(text).toContain("[4 4] 0 d");
    expect(text).not.toContain("[2 3] 0 d");
  });

  it("fits the widest access code inside the card's margins", async () => {
    const wide = { ...card("Maya", "Johnson", "Room 4", 1), accessCode: "WWWW-MMMM" };
    const [, back] = readPdf((await render([wide])).pdf);
    const code = back?.runs.find((r) => r.text === "WWWW-MMMM");
    const left = backCardOrigin(0).x + CARD_LAYOUT.padding;
    expect(code?.size).toBe(CARD_LAYOUT.code.size);
    // Centred, so a left edge inside the margin means the right edge is too.
    expect(code?.x).toBeGreaterThanOrEqual(left);
  });

  it("prints a blank card's studio, name and class lines and QR on the front, and its code on the back (D138)", async () => {
    const [front, back] = readPdf((await render([blank(2)])).pdf);
    expect(front?.runs.map((r) => r.text)).toEqual(["North Peak Photo", "Name", "Class", "1112"]);
    expect(front?.rects.length).toBeGreaterThan(20);
    expect(back?.runs.map((r) => r.text)).toEqual([
      "North Peak Photo",
      "Blank card",
      "Access code",
      "JKMN-PQRS",
      "Go to shop.example.test, enter your code",
      "1112",
    ]);
  });

  it("never prints an access code on a front page", async () => {
    const cards = [
      ...[1, 2, 3, 4, 5].map((n) => card("Maya", `Johnson${n}`, n % 2 ? "Room 4" : null, n)),
      blank(6),
    ];
    const read = readPdf((await render(cards)).pdf);
    expect(read).toHaveLength(4);
    const codes = ["K7QM-4XPA", "JKMN-PQRS"];
    const onPage = (page: Page | undefined) =>
      (page?.runs ?? []).filter((r) => codes.some((c) => r.text.includes(c))).length;
    expect([read[0], read[2]].map(onPage)).toEqual([0, 0]);
    expect([read[1], read[3]].map(onPage)).toEqual([4, 2]);
    // Nor the code's characters split across runs: no front run is set at the code's size.
    for (const front of [read[0], read[2]])
      expect(front?.runs.some((r) => r.size === CARD_LAYOUT.code.size)).toBe(false);
  });

  it("puts each card's back in the mirrored column, so long-edge duplex lands it behind its front", async () => {
    const cards = [1, 2, 3].map((n) => card(`Kid${n}`, "Johnson", "Room 4", n));
    cards[1] = { ...cards[1], accessCode: "AAAA-BBBB" } as (typeof cards)[number];
    cards[2] = { ...cards[2], accessCode: "CCCC-DDDD" } as (typeof cards)[number];
    const [front, back] = readPdf((await render(cards)).pdf);
    for (const [i, code] of ["K7QM-4XPA", "AAAA-BBBB", "CCCC-DDDD"].entries()) {
      const name = front?.runs.find((r) => r.text === `Kid${i + 1} Johnson`);
      const onBack = back?.runs.find((r) => r.text === code);
      if (!name || !onBack) throw new Error(`Card ${i} is missing a side`);
      const f = slot(name.x, name.baseline);
      const b = slot(onBack.x, onBack.baseline);
      // The back names the same child and carries the same match mark as its front, in the same slot.
      const at = (page: Page | undefined, text: string) =>
        page?.runs.filter((r) => r.text === text).map((r) => slot(r.x, r.baseline));
      expect(at(back, `Kid${i + 1} J.`)).toEqual([b]);
      const mark = `000${i + 1}`;
      expect(at(front, mark)).toEqual([f]);
      expect(at(back, mark)).toEqual([b]);
      expect(f).toEqual(slot(cardOrigin(i).x, cardOrigin(i).y));
      expect(b).toEqual(slot(backCardOrigin(i).x, backCardOrigin(i).y));
      // Same row, opposite column.
      expect(b.row).toBe(f.row);
      expect(b.column).toBe(CARD_LAYOUT.columns - 1 - f.column);
    }
  });

  it("fits the longest names the roster allows", async () => {
    const { pdf } = await render([card("W".repeat(60), "M".repeat(60), "R".repeat(60), 1)]);
    expect(pages(pdf)).toBe(2);
    // Cut to fit, never over the neighbouring card.
    const [front] = readPdf(pdf);
    expect(front?.runs.some((r) => r.text.endsWith("…"))).toBe(true);
  });

  it("prints 400 cards (100 pages) quickly", async () => {
    const started = performance.now();
    const many = Array.from({ length: 400 }, (_, n) => card("Maya", "Johnson", "Room 4", n));
    const { pdf } = await renderQrCardsPdf(many, TEXTS);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
    expect(performance.now() - started).toBeLessThan(15_000);
  });
});
