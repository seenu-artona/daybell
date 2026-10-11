import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  assertSafeXlsx,
  cellText,
  decodeCsv,
  RosterFileError,
  readRosterFile,
  toTable,
  XLSX_MAX_UNPACKED_BYTES,
} from "./roster-file";

const bytes = (...values: number[]) => new Uint8Array(values).buffer;
const csv = (text: string | Uint8Array, name = "roster.csv") =>
  new File([text as BlobPart], name, { type: "text/csv" });

describe("decodeCsv", () => {
  it("reads UTF-8 and strips the byte order mark", () => {
    const utf8 = new TextEncoder().encode("﻿Zoë,Brontë");
    expect(decodeCsv(utf8.buffer as ArrayBuffer)).toBe("Zoë,Brontë");
  });

  it("falls back to Windows-1252 for Excel's CSV on Windows", () => {
    // "Zoë" with ë as the single byte 0xEB, which is not valid UTF-8.
    expect(decodeCsv(bytes(0x5a, 0x6f, 0xeb))).toBe("Zoë");
  });

  const utf16 = (text: string, bigEndian: boolean, bom: boolean) => {
    const out: number[] = bom ? (bigEndian ? [0xfe, 0xff] : [0xff, 0xfe]) : [];
    for (const unit of Array.from(text, (c) => c.charCodeAt(0)))
      out.push(...(bigEndian ? [unit >> 8, unit & 0xff] : [unit & 0xff, unit >> 8]));
    return new Uint8Array(out).buffer;
  };

  it("reads UTF-16 with a byte order mark, either way round", () => {
    expect(decodeCsv(utf16("First,Last\nZoë,Brontë", false, true))).toBe("First,Last\nZoë,Brontë");
    expect(decodeCsv(utf16("First,Last\nZoë,Brontë", true, true))).toBe("First,Last\nZoë,Brontë");
  });

  it("recognises UTF-16 without a byte order mark by its NULs", () => {
    expect(decodeCsv(utf16("First,Last\nMaya,Johnson", false, false))).toBe(
      "First,Last\nMaya,Johnson",
    );
    expect(decodeCsv(utf16("First,Last\nMaya,Johnson", true, false))).toBe(
      "First,Last\nMaya,Johnson",
    );
    expect(decodeCsv(new TextEncoder().encode("First,Last").buffer as ArrayBuffer)).toBe(
      "First,Last",
    );
  });
});

describe("cellText", () => {
  it("turns cells into text without losing student IDs", () => {
    expect(cellText(204517)).toBe("204517");
    expect(cellText(4.5)).toBe("4.5");
    expect(cellText(true)).toBe("yes");
    expect(cellText(false)).toBe("no");
    expect(cellText(null)).toBe("");
    expect(cellText(undefined)).toBe("");
    expect(cellText("  Maya ")).toBe("Maya");
    expect(cellText(new Date("2016-03-09T00:00:00Z"))).toBe("2016-03-09");
  });

  it("strips NULs left by broken exports", () => {
    expect(cellText("Ma\u0000ya\u0000")).toBe("Maya");
    expect(cellText({ toString: () => "S-\u00001" })).toBe("S-1");
  });
});

describe("toTable", () => {
  it("uses the first non-empty row as the header and pads short rows", () => {
    expect(
      toTable([
        ["", ""],
        ["First", "Last", "Class"],
        ["Maya", "Johnson"],
        ["", "", ""],
      ]),
    ).toEqual({ headers: ["First", "Last", "Class"], rows: [["Maya", "Johnson", ""]], lines: [3] });
  });

  it("keeps each row's number in the file across blank rows", () => {
    const table = toTable([
      ["First", "Last"],
      ["Maya", "J"],
      [""],
      ["", ""],
      ["Liam", "C"],
      ["Ava", "P"],
    ]);
    expect(table.rows.map((r) => r[0])).toEqual(["Maya", "Liam", "Ava"]);
    expect(table.lines).toEqual([2, 5, 6]);
  });

  it("handles 5,000 wide rows without spreading them into one call", () => {
    const rows = Array.from({ length: 5000 }, (_, i) => [
      `Child ${i}`,
      "x",
      ...(i === 4999 ? ["wide"] : []),
    ]);
    const table = toTable([["First", "Last"], ...rows]);
    expect(table.headers).toEqual(["First", "Last", ""]);
    expect(table.rows[0]).toEqual(["Child 0", "x", ""]);
  });

  it("refuses files with no data rows or more than 5,000", () => {
    expect(() => toTable([["First", "Last"]])).toThrow(RosterFileError);
    const big = [["First"], ...Array.from({ length: 5001 }, (_, i) => [`Child ${i}`])];
    expect(() => toTable(big)).toThrow(expect.objectContaining({ problem: "tooManyRows" }));
    expect(toTable(big.slice(0, 5001)).rows).toHaveLength(5000);
  });
});

describe("readRosterFile", () => {
  it("parses CSV with quotes, and semicolon files from European Excel", async () => {
    const [comma] = await readRosterFile(csv('First,Last\n"Mary, Jo",O\'Neil\n\n'));
    // Trailing blank lines stay as blank rows; toTable skips them.
    expect(comma?.cells).toEqual([["First", "Last"], ["Mary, Jo", "O'Neil"], [""], [""]]);
    expect(toTable(comma?.cells ?? []).rows).toEqual([["Mary, Jo", "O'Neil"]]);
    const [semi] = await readRosterFile(csv("First;Last;Class\nMaya;Johnson;4B\n"));
    expect(semi?.cells[1]).toEqual(["Maya", "Johnson", "4B"]);
  });

  it("keeps blank CSV lines so row numbers match the file", async () => {
    const [sheet] = await readRosterFile(csv("First,Last\n\nMaya,Johnson\n\n\nLiam,Chen\n"));
    expect(toTable(sheet?.cells ?? []).lines).toEqual([3, 6]);
  });

  it("reads Excel files, keeping numbers as whole-number text", async () => {
    const xlsx = readFileSync(join(__dirname, "..", "e2e", "fixtures", "roster.xlsx"));
    const sheets = await readRosterFile(new File([xlsx], "roster.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["Roster"]);
    expect(sheets[0]?.cells[1]).toEqual(["Olivia", "Brown", "4C", "S-101", "4"]);
  });

  it("refuses an Excel file that would unpack to too much before unpacking it", async () => {
    const bomb = zip([{ name: "xl/worksheets/sheet1.xml", packed: 60_000, unpacked: 300_000_000 }]);
    await expect(readRosterFile(new File([bomb], "roster.xlsx"))).rejects.toMatchObject({
      problem: "unreadable",
    });
  });

  it("refuses files over 5 MB and unreadable spreadsheets", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv");
    await expect(readRosterFile(big)).rejects.toMatchObject({ problem: "tooBig" });
    await expect(readRosterFile(new File(["not a zip"], "x.xlsx"))).rejects.toMatchObject({
      problem: "unreadable",
    });
  });
});

/** A zip with only a central directory that declares the given sizes (enough for assertSafeXlsx). */
function zip(
  entries: { name: string; packed: number; unpacked: number }[],
): Uint8Array<ArrayBuffer> {
  const parts: number[] = [];
  const u16 = (n: number) => parts.push(n & 0xff, (n >> 8) & 0xff);
  const u32 = (n: number) => parts.push(n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, n >>> 24);
  for (const e of entries) {
    const name = new TextEncoder().encode(e.name);
    u32(0x02014b50);
    for (let i = 0; i < 6; i++) u16(0); // versions, flags, method, time, date
    u32(0); // crc
    u32(e.packed);
    u32(e.unpacked);
    u16(name.length);
    for (let i = 0; i < 4; i++) u16(0); // extra, comment, disk, internal attributes
    u32(0); // external attributes
    u32(0); // local header offset
    parts.push(...name);
  }
  const size = parts.length;
  u32(0x06054b50);
  u16(0);
  u16(0);
  u16(entries.length);
  u16(entries.length);
  u32(size);
  u32(0);
  u16(0);
  return new Uint8Array(parts);
}

describe("assertSafeXlsx", () => {
  const refuses = (bytes: Uint8Array) =>
    expect(() => assertSafeXlsx(bytes)).toThrow(expect.objectContaining({ problem: "unreadable" }));

  it("accepts a real roster spreadsheet", () => {
    const xlsx = readFileSync(join(__dirname, "..", "e2e", "fixtures", "roster.xlsx"));
    expect(() => assertSafeXlsx(new Uint8Array(xlsx))).not.toThrow();
  });

  it("accepts ordinary sizes, and tiny entries however well they compress", () => {
    expect(() =>
      assertSafeXlsx(
        zip([
          { name: "xl/sharedStrings.xml", packed: 200_000, unpacked: 2_000_000 },
          { name: "xl/styles.xml", packed: 10, unpacked: 50_000 },
        ]),
      ),
    ).not.toThrow();
  });

  it("refuses an entry or a total over 50 MB", () => {
    refuses(zip([{ name: "a.xml", packed: 4_000_000, unpacked: XLSX_MAX_UNPACKED_BYTES + 1 }]));
    refuses(
      zip([
        { name: "a.xml", packed: 4_000_000, unpacked: 30_000_000 },
        { name: "b.xml", packed: 4_000_000, unpacked: 30_000_000 },
      ]),
    );
  });

  it("refuses a large entry compressed more than 100 to 1", () => {
    refuses(zip([{ name: "a.xml", packed: 20_000, unpacked: 2_000_001 }]));
  });

  it("refuses ZIP64 and anything that isn't a zip", () => {
    refuses(zip([{ name: "a.xml", packed: 0xffffffff, unpacked: 0xffffffff }]));
    refuses(new TextEncoder().encode("not a zip at all, just text"));
    refuses(new Uint8Array(0));
  });
});
