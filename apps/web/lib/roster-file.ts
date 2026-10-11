import { ROSTER_MAX_ROWS } from "@daybell/core";

/**
 * Reads a roster file in the browser (ADR 0011; D113). The raw file is never uploaded, stored or logged: only the rows
 * the studio confirms are sent to the API. The parsers load only when a file is chosen, so the job page stays small.
 */

export const ROSTER_MAX_BYTES = 5 * 1024 * 1024;
export const ROSTER_FILE_ACCEPT =
  ".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

export type RosterFileProblem = "tooBig" | "tooManyRows" | "unreadable" | "empty";

export class RosterFileError extends Error {
  constructor(readonly problem: RosterFileProblem) {
    super(problem);
    this.name = "RosterFileError";
  }
}

export interface RosterSheet {
  name: string;
  cells: string[][];
}

export interface RosterTable {
  headers: string[];
  rows: string[][];
  /** Each data row's row number in the file (1-based), so problems point at the right row after blank ones. */
  lines: number[];
}

/**
 * UTF-16 when the file says so (a byte order mark) or looks like it (a NUL in every other byte, as Excel's "Unicode
 * text" without a BOM); else UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (Excel's "CSV" on
 * Windows). No BOM.
 */
export function decodeCsv(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  const utf16 = utf16Encoding(bytes);
  let text: string;
  if (utf16) {
    text = new TextDecoder(utf16).decode(bytes);
  } else {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      text = new TextDecoder("windows-1252").decode(bytes);
    }
  }
  return text.replace(/^\uFEFF/, "");
}

function utf16Encoding(bytes: Uint8Array): "utf-16le" | "utf-16be" | null {
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return "utf-16le";
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return "utf-16be";
  // Without a BOM: Latin text in UTF-16 has a NUL in most pairs, on the same side; UTF-8 and Windows-1252 have none.
  const pairs = Math.min(bytes.length, 4096) >> 1;
  if (pairs < 2) return null;
  let evenNul = 0;
  let oddNul = 0;
  for (let i = 0; i < pairs * 2; i += 2) {
    if (bytes[i] === 0) evenNul++;
    if (bytes[i + 1] === 0) oddNul++;
  }
  if (oddNul >= pairs * 0.4 && evenNul < pairs * 0.1) return "utf-16le";
  if (evenNul >= pairs * 0.4 && oddNul < pairs * 0.1) return "utf-16be";
  return null;
}

/** A spreadsheet cell as text: student ID 204517 stays "204517", dates become YYYY-MM-DD. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  // NULs never belong in a roster; broken exports leave them behind.
  if (typeof value === "string") return value.replaceAll("\u0000", "").trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).replaceAll("\u0000", "").trim();
}

/**
 * The first non-empty row is the header; the other non-empty rows are data. `cells` are the file's rows in order, blank
 * ones included, so each data row keeps its row number in the file.
 */
export function toTable(cells: readonly (readonly string[])[]): RosterTable {
  const nonEmpty: { row: readonly string[]; line: number }[] = [];
  cells.forEach((row, i) => {
    if (row.some((c) => c.trim() !== "")) nonEmpty.push({ row, line: i + 1 });
  });
  if (nonEmpty.length < 2) throw new RosterFileError("empty");
  const [header, ...data] = nonEmpty as [(typeof nonEmpty)[number], ...typeof nonEmpty];
  if (data.length > ROSTER_MAX_ROWS) throw new RosterFileError("tooManyRows");
  // A loop, not Math.max(...rows): spreading thousands of arguments can overflow the stack.
  let width = header.row.length;
  for (const { row } of data) if (row.length > width) width = row.length;
  const pad = (row: readonly string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
  return {
    headers: pad(header.row),
    rows: data.map((d) => pad(d.row)),
    lines: data.map((d) => d.line),
  };
}

/** Limits for what an Excel file may unpack to: a 5,000-row roster is a few MB, so more is a zip bomb. */
export const XLSX_MAX_UNPACKED_BYTES = 50 * 1024 * 1024;
export const XLSX_MAX_RATIO = 100;
/** Entries smaller than this can't hurt, whatever their ratio (tiny repetitive XML compresses very well). */
const RATIO_CHECK_FROM_BYTES = 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * Refuses a zip bomb before any unpacking: reads the sizes each entry declares in the zip's central directory, the
 * sizes the unzipper then allocates and stops at. Throws RosterFileError("unreadable") for anything too big, too
 * compressed, ZIP64 (never needed for a roster) or malformed.
 */
export function assertSafeXlsx(bytes: Uint8Array): void {
  const bad = () => new RosterFileError("unreadable");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end-of-central-directory record: 22 bytes plus a comment of up to 65,535, at the very end.
  let eocd = -1;
  for (let i = bytes.length - 22; i >= 0 && i >= bytes.length - 22 - 0xffff; i--) {
    if (view.getUint32(i, true) === EOCD_SIGNATURE) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw bad();
  const entries = view.getUint16(eocd + 10, true);
  const directorySize = view.getUint32(eocd + 12, true);
  const directoryOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || directoryOffset === 0xffffffff) throw bad();
  if (directoryOffset + directorySize > eocd) throw bad();
  let at = directoryOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (at + 46 > eocd || view.getUint32(at, true) !== CENTRAL_SIGNATURE) throw bad();
    const packed = view.getUint32(at + 20, true);
    const unpacked = view.getUint32(at + 24, true);
    if (packed === 0xffffffff || unpacked === 0xffffffff) throw bad();
    total += unpacked;
    if (unpacked > XLSX_MAX_UNPACKED_BYTES || total > XLSX_MAX_UNPACKED_BYTES) throw bad();
    if (unpacked >= RATIO_CHECK_FROM_BYTES && unpacked > XLSX_MAX_RATIO * Math.max(packed, 1))
      throw bad();
    at +=
      46 +
      view.getUint16(at + 28, true) +
      view.getUint16(at + 30, true) +
      view.getUint16(at + 32, true);
  }
}

function isXlsx(file: File): boolean {
  return (
    /\.xlsx$/i.test(file.name) ||
    file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
  );
}

async function readCsv(file: File): Promise<RosterSheet[]> {
  const text = decodeCsv(await file.arrayBuffer());
  const Papa = (await import("papaparse")).default;
  // The delimiter is detected, so semicolon files from European Excel work too. Blank lines are kept here (toTable
  // skips them) so row numbers match the file.
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: false });
  return [{ name: file.name, cells: result.data.map((row) => row.map(cellText)) }];
}

async function readXlsx(file: File): Promise<RosterSheet[]> {
  const buffer = await file.arrayBuffer();
  assertSafeXlsx(new Uint8Array(buffer));
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  // Rows come back in sheet order with blank rows in between, so row numbers match the spreadsheet.
  const sheets = await readXlsxFile(buffer);
  return sheets.map((s) => ({ name: s.sheet, cells: s.data.map((row) => row.map(cellText)) }));
}

/** Every sheet of a CSV (one) or Excel file, as text cells. Throws RosterFileError with a reason to show. */
export async function readRosterFile(file: File): Promise<RosterSheet[]> {
  if (file.size > ROSTER_MAX_BYTES) throw new RosterFileError("tooBig");
  let sheets: RosterSheet[];
  try {
    sheets = isXlsx(file) ? await readXlsx(file) : await readCsv(file);
  } catch {
    // Never log the file or the parser's message: either could contain children's names.
    throw new RosterFileError("unreadable");
  }
  if (sheets.length === 0) throw new RosterFileError("empty");
  return sheets;
}
