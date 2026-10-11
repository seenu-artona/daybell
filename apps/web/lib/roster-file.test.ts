import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { cellText, decodeCsv, RosterFileError, readRosterFile, toTable } from "./roster-file";

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
    ).toEqual({ headers: ["First", "Last", "Class"], rows: [["Maya", "Johnson", ""]] });
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
    expect(comma?.cells).toEqual([
      ["First", "Last"],
      ["Mary, Jo", "O'Neil"],
    ]);
    const [semi] = await readRosterFile(csv("First;Last;Class\nMaya;Johnson;4B\n"));
    expect(semi?.cells[1]).toEqual(["Maya", "Johnson", "4B"]);
  });

  it("reads Excel files, keeping numbers as whole-number text", async () => {
    const xlsx = readFileSync(join(__dirname, "..", "e2e", "fixtures", "roster.xlsx"));
    const sheets = await readRosterFile(new File([xlsx], "roster.xlsx"));
    expect(sheets.map((s) => s.name)).toEqual(["Roster"]);
    expect(sheets[0]?.cells[1]).toEqual(["Olivia", "Brown", "4C", "S-101", "4"]);
  });

  it("refuses files over 5 MB and unreadable spreadsheets", async () => {
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv");
    await expect(readRosterFile(big)).rejects.toMatchObject({ problem: "tooBig" });
    await expect(readRosterFile(new File(["not a zip"], "x.xlsx"))).rejects.toMatchObject({
      problem: "unreadable",
    });
  });
});
