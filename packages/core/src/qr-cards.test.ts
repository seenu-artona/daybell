import { describe, expect, it } from "vitest";
import {
  backCardOrigin,
  CARD_CODE_ALPHABET,
  CARD_CODE_LENGTH,
  CARD_LAYOUT,
  type CardPerson,
  cardChildren,
  cardOrigin,
  cardQrPayload,
  fitLine,
  fitName,
  isCardCode,
  type MeasureText,
  paginate,
  parseCardQrPayload,
  printableText,
  shopLinkText,
  sortCardChildren,
} from "./qr-cards";

const CODE = "0123456789ABCDEFGHJK";

const person = (
  id: string,
  firstName: string,
  lastName: string,
  group: string | null,
  doNotPhotograph = false,
): CardPerson => ({
  id,
  firstName,
  lastName,
  group: group ? { id: `g-${group}`, name: group } : null,
  doNotPhotograph,
});

describe("card codes and the QR payload", () => {
  it("uses Crockford base32: 32 symbols, no I, L, O or U", () => {
    expect(new Set(CARD_CODE_ALPHABET).size).toBe(32);
    for (const c of "ILOU") expect(CARD_CODE_ALPHABET).not.toContain(c);
    expect(CARD_CODE_LENGTH * Math.log2(32)).toBe(100);
  });

  it("matches the database's check (^[0-9A-HJKMNP-TV-Z]{20}$)", () => {
    const db = /^[0-9A-HJKMNP-TV-Z]{20}$/;
    for (const c of CARD_CODE_ALPHABET) expect(db.test(c.repeat(20))).toBe(true);
    for (const c of "ILOU") expect(db.test(c.repeat(20))).toBe(false);
    expect(isCardCode(CODE)).toBe(true);
    expect(isCardCode(CODE.toLowerCase())).toBe(false);
    expect(isCardCode(CODE.slice(1))).toBe(false);
  });

  it("puts only the versioned card code in the QR, in QR alphanumeric characters", () => {
    const payload = cardQrPayload(CODE);
    expect(payload).toBe(`DBC1:${CODE}`);
    expect(payload).toMatch(/^[0-9A-Z $%*+\-./:]+$/);
    expect(payload).toHaveLength(25);
    expect(() => cardQrPayload("K7QM4XPA")).toThrow();
  });

  it("reads a scanned card back, and nothing else", () => {
    expect(parseCardQrPayload(` DBC1:${CODE}\n`)).toBe(CODE);
    expect(parseCardQrPayload(CODE)).toBeNull();
    expect(parseCardQrPayload(`DBC2:${CODE}`)).toBeNull();
    expect(parseCardQrPayload("DBC1:K7QM4XPA")).toBeNull();
    expect(parseCardQrPayload("https://example.test")).toBeNull();
  });
});

describe("which children get a card", () => {
  const roster = [
    person("1", "Maya", "Johnson", "Room 1"),
    person("2", "Liam", "Chen", "Room 2"),
    person("3", "Noah", "Garcia", null),
    person("4", "Zoe", "Optout", "Room 1", true),
  ];

  it("never a child marked Do not photograph", () => {
    expect(cardChildren(roster, { kind: "job" }).map((c) => c.id)).toEqual(["1", "2", "3"]);
    expect(cardChildren(roster, { kind: "child", childId: "4" })).toEqual([]);
  });

  it("chosen classes, with or without the children who have none", () => {
    const ids = (groupIds: string[], noGroup: boolean) =>
      cardChildren(roster, { kind: "groups", groupIds, noGroup }).map((c) => c.id);
    expect(ids(["g-Room 1"], false)).toEqual(["1"]);
    expect(ids(["g-Room 1"], true)).toEqual(["1", "3"]);
    expect(ids([], true)).toEqual(["3"]);
    expect(ids([], false)).toEqual([]);
  });

  it("one child, from the child panel", () => {
    expect(cardChildren(roster, { kind: "child", childId: "2" }).map((c) => c.id)).toEqual(["2"]);
  });
});

describe("card order (D138: sorted by class)", () => {
  it("sorts by class with numbers in order, no class last, then last and first name", () => {
    const sorted = sortCardChildren([
      person("a", "Zed", "Adams", null),
      person("b", "Ann", "Lee", "Room 10"),
      person("c", "Bob", "lee", "Room 2"),
      person("d", "Amy", "Lee", "Room 2"),
      person("e", "Cal", "Diaz", "Room 2"),
      person("f", "Amy", "Lee", "Room 2"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["e", "d", "f", "c", "b", "a"]);
  });

  it("keeps two classes whose names compare equal apart (by class id)", () => {
    const a = (id: string, group: string, groupId: string): CardPerson => ({
      id,
      firstName: "Amy",
      lastName: id,
      group: { id: groupId, name: group },
      doNotPhotograph: false,
    });
    const sorted = sortCardChildren([
      a("A", "Salle é", "g2"),
      a("B", "Salle e", "g1"),
      a("C", "Salle é", "g2"),
    ]);
    expect(sorted.map((c) => c.id)).toEqual(["B", "A", "C"]);
  });

  it("never changes between prints (the id breaks ties)", () => {
    const people = [person("y", "Amy", "Lee", "A"), person("x", "Amy", "Lee", "A")];
    expect(sortCardChildren(people).map((c) => c.id)).toEqual(["x", "y"]);
    expect(sortCardChildren([...people].reverse()).map((c) => c.id)).toEqual(["x", "y"]);
  });
});

describe("pages", () => {
  it("puts four cards on a page", () => {
    expect(paginate([1, 2, 3, 4, 5]).map((p) => p.length)).toEqual([4, 1]);
    expect(paginate([1, 2, 3, 4])).toHaveLength(1);
    expect(paginate([])).toEqual([]);
  });

  it("lays out US Letter two by two", () => {
    const { page, card, columns, rows } = CARD_LAYOUT;
    expect(page).toEqual({ width: 612, height: 792 });
    expect(card.width * columns).toBe(page.width);
    expect(card.height * rows).toBe(page.height);
    expect([0, 1, 2, 3].map(cardOrigin)).toEqual([
      { x: 0, y: 0 },
      { x: 306, y: 0 },
      { x: 0, y: 396 },
      { x: 306, y: 396 },
    ]);
  });

  it("mirrors the back page's columns for long-edge duplex, so each back lands behind its own front", () => {
    const { page, card } = CARD_LAYOUT;
    expect([0, 1, 2, 3].map(backCardOrigin)).toEqual([
      { x: 306, y: 0 },
      { x: 0, y: 0 },
      { x: 306, y: 396 },
      { x: 0, y: 396 },
    ]);
    // Flipped on the long edge, a back's left edge x lands at page.width - x - card.width: its front's left edge.
    for (const i of [0, 1, 2, 3]) {
      const front = cardOrigin(i);
      const back = backCardOrigin(i);
      expect(page.width - back.x - card.width).toBe(front.x);
      expect(back.y).toBe(front.y);
    }
  });

  it("prints a QR symbol of at least 1.75 inches, whose quiet zone fits inside the card and clear of the text", () => {
    const { qrSymbol, qrQuietModules, card, padding, front } = CARD_LAYOUT;
    expect(qrSymbol).toBeGreaterThanOrEqual(1.75 * 72);
    // The payload is always QR version 2 (25 modules).
    const quiet = (qrSymbol / 25) * qrQuietModules;
    expect(qrSymbol + 2 * quiet).toBeLessThanOrEqual(card.width - 2 * padding);
    expect(front.qr - quiet).toBeGreaterThanOrEqual(front.group + CARD_LAYOUT.group.size * 1.25);
    expect(front.qr + qrSymbol + quiet).toBeLessThanOrEqual(card.height - padding);
  });

  it("stacks each side's text in order, without overlapping, inside the card", () => {
    const { front, back, card, padding } = CARD_LAYOUT;
    const inOrder = (side: readonly (readonly [number, number])[]) => {
      expect(side[0]?.[0]).toBeGreaterThanOrEqual(padding);
      for (let i = 1; i < side.length; i++) {
        const [prevTop, prevSize] = side[i - 1] as readonly [number, number];
        expect((side[i] as readonly [number, number])[0]).toBeGreaterThanOrEqual(
          prevTop + prevSize,
        );
      }
    };
    inOrder([
      [front.studio, CARD_LAYOUT.studio.size],
      [front.name, front.nameBlock],
      [front.group, CARD_LAYOUT.group.size],
    ]);
    inOrder([
      [back.studio, CARD_LAYOUT.studio.size],
      [back.codeLabel, CARD_LAYOUT.codeLabel.size],
      [back.code, CARD_LAYOUT.code.size],
      [back.instructions, CARD_LAYOUT.instructions.size],
    ]);
    expect(back.instructions + CARD_LAYOUT.instructions.size * 2.6).toBeLessThanOrEqual(
      card.height - padding,
    );
  });

  it("keeps the access code off the photographed front (Seenu, Oct 13, 2026)", () => {
    // The front has no place for the code at all; the back has nothing but the code, its label, the studio and the
    // instructions.
    expect(Object.keys(CARD_LAYOUT.front).sort()).toEqual([
      "group",
      "name",
      "nameBlock",
      "qr",
      "studio",
    ]);
    expect(Object.keys(CARD_LAYOUT.back).sort()).toEqual([
      "code",
      "codeLabel",
      "instructions",
      "studio",
    ]);
  });
});

describe("the printed shop link (Seenu, answer 7)", () => {
  it("drops https:// and trailing slashes", () => {
    expect(shopLinkText("https://shop.daybell.com/")).toBe("shop.daybell.com");
    expect(shopLinkText(" http://daybell-staging.vercel.app ")).toBe("daybell-staging.vercel.app");
    expect(shopLinkText("https://example.test/shop//")).toBe("example.test/shop");
  });
});

describe("printableText (Seenu, answer 5)", () => {
  const latin = (cp: number) => cp < 0x250;

  it("keeps Latin letters and accents", () => {
    expect(printableText("Zoë Ñúñez-O'Brien", latin)).toEqual({
      text: "Zoë Ñúñez-O'Brien",
      replaced: false,
    });
  });

  it("composes combining accents first", () => {
    expect(printableText("Zoë", latin)).toEqual({ text: "Zoë", replaced: false });
  });

  it("prints a ? for each character the font lacks, and says so", () => {
    expect(printableText("Anna 李", latin)).toEqual({ text: "Anna ?", replaced: true });
    expect(printableText("😀", latin)).toEqual({ text: "?", replaced: true });
  });
});

describe("fitting text", () => {
  // A fake font: every character is half the size wide.
  const measure: MeasureText = (text, size) => [...text].length * size * 0.5;

  it("uses the largest size that fits", () => {
    expect(fitLine("Maya", 100, { max: 22, min: 12 }, measure)).toEqual({
      text: "Maya",
      size: 22,
      fits: true,
    });
    expect(fitLine("x".repeat(15), 100, { max: 22, min: 12 }, measure)).toEqual({
      text: "x".repeat(15),
      size: 13,
      fits: true,
    });
  });

  it("cuts with an ellipsis at the smallest size", () => {
    const fitted = fitLine("x".repeat(40), 100, { max: 22, min: 12 }, measure);
    expect(fitted.fits).toBe(false);
    expect(fitted.size).toBe(12);
    expect(fitted.text.endsWith("…")).toBe(true);
    expect(measure(fitted.text, 12)).toBeLessThanOrEqual(100);
  });

  it("puts a long name on two lines before cutting it", () => {
    const width = CARD_LAYOUT.card.width - 2 * CARD_LAYOUT.padding;
    expect(fitName("Maya", "Johnson", width, measure)).toEqual({
      lines: ["Maya Johnson"],
      size: 22,
    });
    const long = fitName("Maximiliana Alexandra", "Featherstonehaugh-Worthington", width, measure);
    expect(long.lines).toEqual(["Maximiliana Alexandra", "Featherstonehaugh-Worthington"]);
    expect(long.size).toBeGreaterThanOrEqual(CARD_LAYOUT.name.twoLineMin);
    const huge = fitName("A".repeat(60), "B".repeat(60), width, measure);
    expect(huge.size).toBe(CARD_LAYOUT.name.twoLineMin);
    for (const line of huge.lines) expect(measure(line, huge.size)).toBeLessThanOrEqual(width);
  });
});
