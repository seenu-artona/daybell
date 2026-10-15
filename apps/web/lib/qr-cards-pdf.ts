import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  backCardOrigin,
  CARD_LAYOUT,
  cardMatchMark,
  cardOrigin,
  fitLine,
  fitName,
  type MeasureText,
  paginate,
  parentDisplayName,
  parseCardQrPayload,
  printableText,
} from "@daybell/core";
import tokens from "@daybell/ui/tokens.json";
import { create as openFont } from "fontkit";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * The QR card PDF (D32, D138; ADR 0015): four cards per US Letter sheet, cut along dashed lines. Built in memory on the
 * server in the studio's region and streamed to the browser; never stored, never logged. Text is Plus Jakarta Sans
 * (embedded, subset); the QR is drawn as vector squares, so it prints sharp at any size.
 *
 * Printed double-sided, flipped on the long edge (Seenu, Oct 13, 2026; ADR 0018): each sheet is a front page, then a
 * back page. The front (photographed on picture day) holds the studio's name, the child's name and class and the QR,
 * never the access code. The back holds the access code, the instructions and the studio's name; its columns are
 * mirrored so each back lands behind its own front. Even a photo of a card whose QR isn't found shows no access code.
 * In case a sheet is flipped the wrong way (security review), the back also names whose card it is (first name and
 * last initial, and class; or "Blank card"), and both sides carry the same match mark (the card ID's last four
 * characters) in the corner.
 */

export interface PrintCard {
  /** null for a blank card: lines for the name and class instead. */
  child: { firstName: string; lastName: string; group: string | null } | null;
  /** What the QR holds: the card ID, never the access code. */
  qrPayload: string;
  /** Shown as K7QM-4XPA. */
  accessCode: string;
}

/** The words on every card, already translated (D96). */
export interface CardTexts {
  /** The PDF's title (metadata). Never a name. */
  title: string;
  studioName: string;
  /** "Class: {name}" in the job's group word (Seenu, answer 7). */
  groupLine: (name: string) => string;
  /** "Class", before a blank line. */
  groupLabel: string;
  /** "Name", before a blank line. */
  nameLabel: string;
  accessCodeLabel: string;
  /** "Go to {link}, enter your code". */
  instructions: string;
  /** "Blank card", on a blank card's back where a child's name would be. */
  blankCard: string;
}

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const REGULAR_PATH = join(FONT_DIR, "PlusJakartaSans-Regular.ttf");
const BOLD_PATH = join(FONT_DIR, "PlusJakartaSans-Bold.ttf");

let fonts: { bold: Buffer; hasGlyph: (cp: number) => boolean } | null = null;

/**
 * The fonts, read once per process (both weights cover the same characters). The route calls this before it makes
 * any card, so a missing font fails the print before blank cards are made.
 */
export function loadFonts() {
  if (!fonts) {
    const face = openFont(readFileSync(REGULAR_PATH));
    fonts = { bold: readFileSync(BOLD_PATH), hasGlyph: (cp) => face.hasGlyphForCodePoint(cp) };
  }
  return fonts;
}

/**
 * Font names in the document. The regular weight is the document's starting font, opened from its path; using the
 * same path as its name reuses it rather than embedding it twice.
 */
const REGULAR = REGULAR_PATH;
const BOLD = "bold";
type FontName = typeof REGULAR | typeof BOLD;

/** A design token's colour (D112): never a raw value in code. */
function color(name: "ink" | "muted" | "line-strong"): string {
  const token = tokens.color.tokens.find((t) => t.name === name);
  if (!token) throw new Error(`Missing colour token ${name}`);
  return token.value;
}

/** Renders the cards. `replacedCards` counts cards with characters the font can't print (shown as "?"). */
export async function renderQrCardsPdf(
  cards: readonly PrintCard[],
  texts: CardTexts,
  options: { compress?: boolean } = {},
): Promise<{ pdf: Buffer; replacedCards: number }> {
  const { bold, hasGlyph } = loadFonts();
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 0,
    autoFirstPage: false,
    compress: options.compress ?? true,
    // Starts in the embedded font, so no standard PDF font is ever loaded. No names in the metadata (D96).
    font: REGULAR_PATH,
    info: { Title: texts.title, Creator: "Silverback", Producer: "Silverback" },
  });
  doc.registerFont(BOLD, bold);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const measure =
    (font: FontName): MeasureText =>
    (text, size) =>
      doc.font(font).fontSize(size).widthOfString(text);

  let replacedCards = 0;
  for (const sheet of paginate(cards)) {
    const replaced = sheet.map(() => false);
    const cleaner = (i: number) => (text: string) => {
      const out = printableText(text, hasGlyph);
      if (out.replaced) replaced[i] = true;
      return out.text;
    };
    // The front page, then the back page behind it.
    doc.addPage();
    cutLines(doc);
    for (const [i, card] of sheet.entries())
      drawFront(doc, cardOrigin(i), card, texts, cleaner(i), measure);
    doc.addPage();
    cutLines(doc);
    for (const [i, card] of sheet.entries())
      drawBack(doc, backCardOrigin(i), card, texts, cleaner(i), measure);
    replacedCards += replaced.filter(Boolean).length;
  }
  doc.end();
  return { pdf: await done, replacedCards };
}

/** Dashed cut lines between the four cards, on both sides of the sheet. */
function cutLines(doc: PDFKit.PDFDocument) {
  const { page, card } = CARD_LAYOUT;
  doc.save().lineWidth(0.5).dash(4, { space: 4 }).strokeColor(color("line-strong"));
  doc.moveTo(card.width, 0).lineTo(card.width, page.height).stroke();
  doc.moveTo(0, card.height).lineTo(page.width, card.height).stroke();
  doc.undash().restore();
}

/** The studio's name, centred at `y` on the card, on both sides. */
function studioLine(
  doc: PDFKit.PDFDocument,
  origin: { x: number; y: number },
  y: number,
  texts: CardTexts,
  clean: (text: string) => string,
  measure: (font: FontName) => MeasureText,
) {
  const { card: size, padding } = CARD_LAYOUT;
  const studio = fitLine(
    clean(texts.studioName),
    size.width - 2 * padding,
    { max: CARD_LAYOUT.studio.size, min: 8 },
    measure(BOLD),
  );
  centered(doc, studio.text, origin.x, origin.y + y, size.width, {
    font: BOLD,
    size: studio.size,
    color: color("muted"),
  });
}

/** The front, photographed on picture day: studio, name, class and QR. Never the access code. */
function drawFront(
  doc: PDFKit.PDFDocument,
  origin: { x: number; y: number },
  card: PrintCard,
  texts: CardTexts,
  clean: (text: string) => string,
  measure: (font: FontName) => MeasureText,
) {
  const { card: size, padding, qrSymbol, front: AT } = CARD_LAYOUT;
  const width = size.width - 2 * padding;
  const x = origin.x + padding;
  const top = origin.y;
  const ink = color("ink");

  studioLine(doc, origin, AT.studio, texts, clean, measure);

  if (card.child) {
    const name = fitName(
      clean(card.child.firstName),
      clean(card.child.lastName),
      width,
      measure(BOLD),
    );
    const lineHeight = name.size * CARD_LAYOUT.name.lineHeight;
    let y = top + AT.name + (AT.nameBlock - lineHeight * name.lines.length) / 2;
    doc.font(BOLD).fontSize(name.size).fillColor(ink);
    for (const line of name.lines) {
      doc.text(line, x, y, { lineBreak: false });
      y += lineHeight;
    }
    if (card.child.group) {
      const group = fitLine(
        clean(texts.groupLine(card.child.group)),
        width,
        { max: CARD_LAYOUT.group.size, min: 9 },
        measure(REGULAR),
      );
      doc
        .font(REGULAR)
        .fontSize(group.size)
        .fillColor(ink)
        .text(group.text, x, top + AT.group, { lineBreak: false });
    } else {
      writeOnLine(doc, x, top + AT.group, width, clean(texts.groupLabel));
    }
  } else {
    // A blank card: lines for the name and class (D138).
    writeOnLine(doc, x, top + AT.name + 22, width, clean(texts.nameLabel));
    writeOnLine(doc, x, top + AT.group, width, clean(texts.groupLabel));
  }

  drawQr(doc, card.qrPayload, origin.x + (size.width - qrSymbol) / 2, top + AT.qr, qrSymbol, ink);
  matchMark(doc, origin, card);
}

/** The match mark, the same on both sides of a card, in the card's bottom-right corner. */
function matchMark(doc: PDFKit.PDFDocument, origin: { x: number; y: number }, card: PrintCard) {
  const { card: size, mark } = CARD_LAYOUT;
  const code = parseCardQrPayload(card.qrPayload);
  if (!code) throw new Error("Not a card QR payload");
  const text = cardMatchMark(code);
  doc.font(REGULAR).fontSize(mark.size).fillColor(color("muted"));
  const x = origin.x + size.width - mark.inset - doc.widthOfString(text);
  doc.text(text, x, origin.y + size.height - mark.inset - mark.size, { lineBreak: false });
}

/** The back, behind the front: studio, the access code (large) and the instructions. */
function drawBack(
  doc: PDFKit.PDFDocument,
  origin: { x: number; y: number },
  card: PrintCard,
  texts: CardTexts,
  clean: (text: string) => string,
  measure: (font: FontName) => MeasureText,
) {
  const { card: size, padding, back: AT } = CARD_LAYOUT;
  const width = size.width - 2 * padding;
  const x = origin.x + padding;
  const top = origin.y;
  const ink = color("ink");

  studioLine(doc, origin, AT.studio, texts, clean, measure);

  // Whose card this is, so a back behind the wrong front is caught before the card goes home.
  const owner = fitLine(
    card.child
      ? clean(parentDisplayName(card.child.firstName, card.child.lastName))
      : clean(texts.blankCard),
    width,
    { max: CARD_LAYOUT.owner.size, min: 8 },
    measure(BOLD),
  );
  centered(doc, owner.text, origin.x, top + AT.owner, size.width, {
    font: BOLD,
    size: owner.size,
    color: ink,
  });
  if (card.child?.group) {
    const group = fitLine(
      clean(texts.groupLine(card.child.group)),
      width,
      { max: CARD_LAYOUT.ownerGroup.size, min: 7 },
      measure(REGULAR),
    );
    centered(doc, group.text, origin.x, top + AT.ownerGroup, size.width, {
      font: REGULAR,
      size: group.size,
      color: ink,
    });
  }

  centered(doc, clean(texts.accessCodeLabel), origin.x, top + AT.codeLabel, size.width, {
    font: REGULAR,
    size: CARD_LAYOUT.codeLabel.size,
    color: color("muted"),
  });
  centered(doc, card.accessCode, origin.x, top + AT.code, size.width, {
    font: BOLD,
    size: CARD_LAYOUT.code.size,
    color: ink,
    spacing: 1.5,
  });
  doc
    .font(REGULAR)
    .fontSize(CARD_LAYOUT.instructions.size)
    .fillColor(ink)
    .text(clean(texts.instructions), x, top + AT.instructions, {
      width,
      align: "center",
      height: CARD_LAYOUT.instructions.size * 2.6,
      ellipsis: true,
    });
  matchMark(doc, origin, card);
}

/** "Name ______": a label and a line to write on, for blank cards and children without a class. */
function writeOnLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string) {
  const size = CARD_LAYOUT.group.size;
  doc.font(REGULAR).fontSize(size).fillColor(color("ink")).text(label, x, y, { lineBreak: false });
  const start = x + doc.widthOfString(label) + 6;
  const baseline = y + size * 1.05;
  doc
    .save()
    .lineWidth(0.75)
    .strokeColor(color("line-strong"))
    .moveTo(start, baseline)
    .lineTo(x + width, baseline)
    .stroke()
    .restore();
}

function centered(
  doc: PDFKit.PDFDocument,
  text: string,
  left: number,
  y: number,
  width: number,
  style: { font: FontName; size: number; color: string; spacing?: number },
) {
  doc.font(style.font).fontSize(style.size).fillColor(style.color);
  const spacing = style.spacing ?? 0;
  const textWidth = doc.widthOfString(text) + spacing * Math.max(0, [...text].length - 1);
  doc.text(text, left + (width - textWidth) / 2, y, {
    lineBreak: false,
    characterSpacing: spacing,
  });
}

/**
 * The QR as filled squares: the symbol is `size` wide at (x, y); the quiet zone the standard asks for lies around it
 * and is left blank (the layout keeps text out of it). Runs of dark modules are joined per row.
 */
function drawQr(
  doc: PDFKit.PDFDocument,
  payload: string,
  x: number,
  y: number,
  size: number,
  fill: string,
) {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const unit = size / modules.size;
  doc.save();
  for (let row = 0; row < modules.size; row++) {
    let col = 0;
    while (col < modules.size) {
      if (!modules.get(row, col)) {
        col++;
        continue;
      }
      const start = col;
      while (col < modules.size && modules.get(row, col)) col++;
      doc.rect(x + start * unit, y + row * unit, (col - start) * unit, unit);
    }
  }
  doc.fillColor(fill).fill();
  doc.restore();
}
