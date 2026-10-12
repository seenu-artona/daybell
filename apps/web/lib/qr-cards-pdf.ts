import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CARD_LAYOUT,
  cardOrigin,
  fitLine,
  fitName,
  type MeasureText,
  paginate,
  printableText,
} from "@daybell/core";
import tokens from "@daybell/ui/tokens.json";
import { create as openFont } from "fontkit";
import PDFDocument from "pdfkit";
import QRCode from "qrcode";

/**
 * The QR card PDF (D32, D138; ADR 0015): four cards per US Letter page, cut along dashed lines. Built in memory on the
 * server in the studio's region and streamed to the browser; never stored, never logged. Text is Plus Jakarta Sans
 * (embedded, subset); the QR is drawn as vector squares, so it prints sharp at any size.
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
}

const FONT_DIR = join(process.cwd(), "assets", "fonts");
const REGULAR_PATH = join(FONT_DIR, "PlusJakartaSans-Regular.ttf");
const BOLD_PATH = join(FONT_DIR, "PlusJakartaSans-Bold.ttf");

let fonts: { regular: Buffer; bold: Buffer; hasGlyph: (cp: number) => boolean } | null = null;

/** Read once per process. Both weights cover the same characters. */
function loadFonts() {
  if (!fonts) {
    const regular = readFileSync(REGULAR_PATH);
    const bold = readFileSync(BOLD_PATH);
    const face = openFont(regular);
    fonts = { regular, bold, hasGlyph: (cp) => face.hasGlyphForCodePoint(cp) };
  }
  return fonts;
}

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
  const { regular, bold, hasGlyph } = loadFonts();
  const doc = new PDFDocument({
    size: "LETTER",
    margin: 0,
    autoFirstPage: false,
    compress: options.compress ?? true,
    // Starts in the embedded font, so no standard PDF font is ever loaded. No names in the metadata (D96).
    font: REGULAR_PATH,
    info: { Title: "QR cards", Creator: "Daybell", Producer: "Daybell" },
  });
  doc.registerFont("regular", regular);
  doc.registerFont("bold", bold);
  const chunks: Buffer[] = [];
  doc.on("data", (chunk: Buffer) => chunks.push(chunk));
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });

  const measure =
    (font: "regular" | "bold"): MeasureText =>
    (text, size) =>
      doc.font(font).fontSize(size).widthOfString(text);

  let replacedCards = 0;
  for (const page of paginate(cards)) {
    doc.addPage();
    cutLines(doc);
    for (const [i, card] of page.entries()) {
      let replaced = false;
      const clean = (text: string) => {
        const out = printableText(text, hasGlyph);
        replaced ||= out.replaced;
        return out.text;
      };
      drawCard(doc, cardOrigin(i), card, texts, clean, measure);
      if (replaced) replacedCards++;
    }
  }
  doc.end();
  return { pdf: await done, replacedCards };
}

/** Dashed cut lines between the four cards. */
function cutLines(doc: PDFKit.PDFDocument) {
  const { page, card } = CARD_LAYOUT;
  doc.save().lineWidth(0.5).dash(4, { space: 4 }).strokeColor(color("line-strong"));
  doc.moveTo(card.width, 0).lineTo(card.width, page.height).stroke();
  doc.moveTo(0, card.height).lineTo(page.width, card.height).stroke();
  doc.undash().restore();
}

/** Vertical positions inside a card, from its top. Fixed, so every card's QR sits in the same place. */
const AT = {
  studio: 24,
  name: 50,
  nameBlock: 56,
  group: 114,
  qr: 138,
  codeLabel: 292,
  code: 305,
  instructions: 344,
} as const;

function drawCard(
  doc: PDFKit.PDFDocument,
  origin: { x: number; y: number },
  card: PrintCard,
  texts: CardTexts,
  clean: (text: string) => string,
  measure: (font: "regular" | "bold") => MeasureText,
) {
  const { card: size, padding, qrSize } = CARD_LAYOUT;
  const width = size.width - 2 * padding;
  const x = origin.x + padding;
  const top = origin.y;
  const ink = color("ink");
  const muted = color("muted");

  const studio = fitLine(
    clean(texts.studioName),
    width,
    { max: CARD_LAYOUT.studio.size, min: 8 },
    measure("bold"),
  );
  doc
    .font("bold")
    .fontSize(studio.size)
    .fillColor(muted)
    .text(studio.text, x, top + AT.studio, { lineBreak: false });

  if (card.child) {
    const name = fitName(
      clean(card.child.firstName),
      clean(card.child.lastName),
      width,
      measure("bold"),
    );
    const lineHeight = name.size * 1.25;
    let y = top + AT.name + (AT.nameBlock - lineHeight * name.lines.length) / 2;
    doc.font("bold").fontSize(name.size).fillColor(ink);
    for (const line of name.lines) {
      doc.text(line, x, y, { lineBreak: false });
      y += lineHeight;
    }
    if (card.child.group) {
      const group = fitLine(
        clean(texts.groupLine(card.child.group)),
        width,
        { max: CARD_LAYOUT.group.size, min: 9 },
        measure("regular"),
      );
      doc
        .font("regular")
        .fontSize(group.size)
        .fillColor(ink)
        .text(group.text, x, top + AT.group, { lineBreak: false });
    } else {
      writeOnLine(doc, x, top + AT.group, width, clean(texts.groupLabel));
    }
  } else {
    writeOnLine(doc, x, top + AT.name + 22, width, clean(texts.nameLabel));
    writeOnLine(doc, x, top + AT.group, width, clean(texts.groupLabel));
  }

  drawQr(doc, card.qrPayload, origin.x + (size.width - qrSize) / 2, top + AT.qr, qrSize, ink);

  centered(doc, clean(texts.accessCodeLabel), origin.x, top + AT.codeLabel, size.width, {
    font: "regular",
    size: CARD_LAYOUT.codeLabel.size,
    color: muted,
  });
  centered(doc, card.accessCode, origin.x, top + AT.code, size.width, {
    font: "bold",
    size: CARD_LAYOUT.code.size,
    color: ink,
    spacing: 1.5,
  });
  doc
    .font("regular")
    .fontSize(CARD_LAYOUT.instructions.size)
    .fillColor(ink)
    .text(clean(texts.instructions), x, top + AT.instructions, {
      width,
      align: "center",
      height: CARD_LAYOUT.instructions.size * 2.6,
      ellipsis: true,
    });
}

/** "Name ______": a label and a line to write on, for blank cards and children without a class. */
function writeOnLine(doc: PDFKit.PDFDocument, x: number, y: number, width: number, label: string) {
  const size = CARD_LAYOUT.group.size;
  doc
    .font("regular")
    .fontSize(size)
    .fillColor(color("ink"))
    .text(label, x, y, { lineBreak: false });
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
  style: { font: "regular" | "bold"; size: number; color: string; spacing?: number },
) {
  doc.font(style.font).fontSize(style.size).fillColor(style.color);
  const spacing = style.spacing ?? 0;
  const textWidth = doc.widthOfString(text) + spacing * Math.max(0, [...text].length - 1);
  doc.text(text, left + (width - textWidth) / 2, y, {
    lineBreak: false,
    characterSpacing: spacing,
  });
}

/** The QR as filled squares, with the quiet zone the standard asks for. Runs of dark modules are joined per row. */
function drawQr(
  doc: PDFKit.PDFDocument,
  payload: string,
  x: number,
  y: number,
  size: number,
  fill: string,
) {
  const { modules } = QRCode.create(payload, { errorCorrectionLevel: "M" });
  const quiet = CARD_LAYOUT.qrQuietModules;
  const unit = size / (modules.size + 2 * quiet);
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
      doc.rect(x + (quiet + start) * unit, y + (quiet + row) * unit, (col - start) * unit, unit);
    }
  }
  doc.fillColor(fill).fill();
  doc.restore();
}
