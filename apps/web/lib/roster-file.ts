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
}

/** UTF-8 when the bytes are valid UTF-8, otherwise Windows-1252 (Excel's "CSV" on Windows). No BOM. */
export function decodeCsv(buffer: ArrayBuffer): string {
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder("windows-1252").decode(buffer);
  }
  return text.replace(/^﻿/, "");
}

/** A spreadsheet cell as text: student ID 204517 stays "204517", dates become YYYY-MM-DD. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? "" : value.toISOString().slice(0, 10);
  return String(value).trim();
}

/** The first non-empty row is the header; the other non-empty rows are data. */
export function toTable(cells: readonly (readonly string[])[]): RosterTable {
  const nonEmpty = cells.filter((row) => row.some((c) => c.trim() !== ""));
  const [headers = [], ...rows] = nonEmpty;
  const width = Math.max(headers.length, ...rows.map((r) => r.length));
  const pad = (row: readonly string[]) => Array.from({ length: width }, (_, i) => row[i] ?? "");
  if (nonEmpty.length < 2) throw new RosterFileError("empty");
  if (rows.length > ROSTER_MAX_ROWS) throw new RosterFileError("tooManyRows");
  return { headers: pad(headers), rows: rows.map(pad) };
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
  // The delimiter is detected, so semicolon files from European Excel work too.
  const result = Papa.parse<string[]>(text, { header: false, skipEmptyLines: "greedy" });
  return [{ name: file.name, cells: result.data.map((row) => row.map(cellText)) }];
}

async function readXlsx(file: File): Promise<RosterSheet[]> {
  const readXlsxFile = (await import("read-excel-file/browser")).default;
  const sheets = await readXlsxFile(file);
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
