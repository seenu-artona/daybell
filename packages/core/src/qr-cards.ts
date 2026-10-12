/**
 * QR cards (Phase 1 step 3; D32, D138; ADR 0015). The card a child takes home: the studio's name, the child's name
 * and class, a QR and the parent access code, four to a US Letter page, sorted by class. The QR holds a random card
 * ID, never the access code, so a photo of a card never reveals the code. Pure functions shared by the print dialog
 * (counts) and the server's PDF (selection, order, layout, text fitting).
 */

/** Crockford base32: no I, L, O or U, so a card ID read aloud or typed can't be misread. */
export const CARD_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** 20 symbols: 100 random bits. */
export const CARD_CODE_LENGTH = 20;
/** Versions the QR payload for the tagging app: "DBC1:" + card code (Daybell card, format 1). */
export const CARD_QR_PREFIX = "DBC1:";
/** Most blank cards one print can make (Seenu, answer 3). */
export const MAX_BLANK_CARDS = 100;
/** D138: four cards per US Letter page. */
export const CARDS_PER_PAGE = 4;

const CARD_CODE = new RegExp(`^[${CARD_CODE_ALPHABET}]{${CARD_CODE_LENGTH}}$`);

export function isCardCode(text: string): boolean {
  return CARD_CODE.test(text);
}

/**
 * What the QR holds. Upper-case letters, digits and ":" only, so it fits QR's compact alphanumeric mode: 25
 * characters make a small, robust code (version 2 at error correction M).
 */
export function cardQrPayload(cardCode: string): string {
  if (!isCardCode(cardCode)) throw new Error("Not a card code");
  return `${CARD_QR_PREFIX}${cardCode}`;
}

/**
 * The card code a scanned QR holds, or null if it isn't a Daybell card. Not used yet: it is for the tagging app in
 * step 5, kept here so the format is defined (and tested) in one place.
 */
export function parseCardQrPayload(text: string): string | null {
  const trimmed = text.trim();
  if (!trimmed.startsWith(CARD_QR_PREFIX)) return null;
  const code = trimmed.slice(CARD_QR_PREFIX.length);
  return isCardCode(code) ? code : null;
}

/** What card selection and order need to know about a child. */
export interface CardPerson {
  id: string;
  firstName: string;
  lastName: string;
  group: { id: string; name: string } | null;
  doNotPhotograph: boolean;
}

/** Which children a print covers (Seenu, answer 4): the whole job, chosen classes (and/or "no class"), or one child. */
export type CardScope =
  | { kind: "job" }
  | { kind: "groups"; groupIds: readonly string[]; noGroup: boolean }
  | { kind: "child"; childId: string };

/** The children a print makes cards for. Children marked Do not photograph never get a card (D138). */
export function cardChildren<T extends CardPerson>(children: readonly T[], scope: CardScope): T[] {
  const inScope = (c: T): boolean => {
    switch (scope.kind) {
      case "job":
        return true;
      case "child":
        return c.id === scope.childId;
      case "groups":
        return c.group ? scope.groupIds.includes(c.group.id) : scope.noGroup;
    }
  };
  return children.filter((c) => !c.doNotPhotograph && inScope(c));
}

const byId = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/**
 * Cards in print order (D138, sorted by class): by class name, numbers in order ("Room 2" before "Room 10"), children
 * without a class last. Two classes whose names compare equal (e.g. differing only by an accent) are kept apart by
 * their id. Then last name, first name and id, so the order never changes between prints.
 */
export function sortCardChildren<T extends CardPerson>(children: readonly T[]): T[] {
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  return [...children].sort((a, b) => {
    if (!a.group !== !b.group) return a.group ? -1 : 1;
    return (
      (a.group && b.group
        ? collator.compare(a.group.name, b.group.name) || byId(a.group.id, b.group.id)
        : 0) ||
      collator.compare(a.lastName, b.lastName) ||
      collator.compare(a.firstName, b.firstName) ||
      byId(a.id, b.id)
    );
  });
}

/** Splits cards into pages of `perPage`. */
export function paginate<T>(items: readonly T[], perPage = CARDS_PER_PAGE): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += perPage) pages.push(items.slice(i, i + perPage));
  return pages;
}

/** The shop link as printed (Seenu, answer 7): no "https://", no trailing slash. */
export function shopLinkText(url: string): string {
  return url
    .trim()
    .replace(/^https?:\/\//i, "")
    .replace(/\/+$/, "");
}

/**
 * Text the card's font can print (Seenu, answer 5: Latin and accents only). Characters the font has no glyph for
 * become "?", and `replaced` says whether any did, so the dialog can warn (by count; names are never logged).
 * Composed first (NFC), so "e" plus a combining accent prints as "é".
 */
export function printableText(
  text: string,
  hasGlyph: (codePoint: number) => boolean,
): { text: string; replaced: boolean } {
  let replaced = false;
  let out = "";
  for (const char of text.normalize("NFC")) {
    const cp = char.codePointAt(0) as number;
    if (char === " " || hasGlyph(cp)) out += char;
    else {
      out += "?";
      replaced = true;
    }
  }
  return { text: out, replaced };
}

/**
 * US Letter in PDF points (72 per inch), two by two, cut along the dashed lines. The QR symbol itself (its modules,
 * not counting the light quiet zone around it) is at least 1.75 inches, the size tagging needs at arm's length. Long
 * names shrink to fit, then go on two lines (first, last), then are cut with "…": a card never prints over its
 * neighbour. `at` is each element's top, measured from the card's top edge.
 */
export const CARD_LAYOUT = {
  page: { width: 612, height: 792 },
  columns: 2,
  rows: 2,
  card: { width: 306, height: 396 },
  padding: 24,
  /** The QR symbol's width and height, quiet zone excluded: 1.78 inches. */
  qrSymbol: 128,
  /** Light modules around the QR, as the QR standard asks; nothing is printed in them. */
  qrQuietModules: 4,
  at: {
    studio: 22,
    name: 42,
    nameBlock: 52,
    group: 100,
    qr: 136,
    codeLabel: 286,
    code: 300,
    instructions: 338,
  },
  studio: { size: 11 },
  name: { max: 22, min: 12, twoLineMin: 11, lineHeight: 1.15 },
  group: { size: 12 },
  codeLabel: { size: 9 },
  code: { size: 26 },
  instructions: { size: 10 },
} as const;

/** The top-left corner of the i-th card on its page (0..3: left to right, then top to bottom). */
export function cardOrigin(index: number): { x: number; y: number } {
  const { columns, card } = CARD_LAYOUT;
  return { x: (index % columns) * card.width, y: Math.floor(index / columns) * card.height };
}

export type MeasureText = (text: string, size: number) => number;

/**
 * The largest size from `max` down to `min` (whole points) at which `text` fits `width`; at `min` it is cut and ends
 * with "…" if it still doesn't fit.
 */
export function fitLine(
  text: string,
  width: number,
  { max, min }: { max: number; min: number },
  measure: MeasureText,
): { text: string; size: number; fits: boolean } {
  for (let size = max; size >= min; size--)
    if (measure(text, size) <= width) return { text, size, fits: true };
  const chars = [...text];
  while (chars.length > 1 && measure(`${chars.join("").trimEnd()}…`, min) > width) chars.pop();
  return { text: `${chars.join("").trimEnd()}…`, size: min, fits: false };
}

/**
 * A child's name on a card: "First Last" on one line if it fits at a readable size; otherwise first and last name on
 * two lines, each the same size, shrunk or cut to fit.
 */
export function fitName(
  firstName: string,
  lastName: string,
  width: number,
  measure: MeasureText,
): { lines: string[]; size: number } {
  const { name } = CARD_LAYOUT;
  const one = fitLine(`${firstName} ${lastName}`, width, { max: name.max, min: name.min }, measure);
  if (one.fits) return { lines: [one.text], size: one.size };
  const range = { max: name.max, min: name.twoLineMin };
  const size = Math.min(
    fitLine(firstName, width, range, measure).size,
    fitLine(lastName, width, range, measure).size,
  );
  return {
    lines: [firstName, lastName].map(
      (part) => fitLine(part, width, { max: size, min: size }, measure).text,
    ),
    size,
  };
}
