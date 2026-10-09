import { describe, expect, it } from "vitest";
import { readImportFile } from "./catalogImportFile";
import { makeXlsx } from "./testXlsx";

// KB-314 (D68): turning a picked file into a table of TEXT - a .csv (UTF-8, any of the usual delimiters) or a real
// .xlsx. Nothing is interpreted here (no prices, no units): that is domain/catalogImport.ts.

const D = (...codes: number[]) => String.fromCharCode(...codes);
const csv = (text: string, name = "items.csv") => new File([text], name, { type: "text/csv" });
const bytes = (...b: number[]) => new File([new Uint8Array(b)], "x.csv");

describe("readImportFile - csv", () => {
  it("reads headers and rows, Hindi names intact", async () => {
    const hindi = D(0x91a, 0x940, 0x928, 0x940);
    const r = await readImportFile(csv(`Name,Price,Unit\n${hindi},45,kg\nSalt,20,kg\n`));
    expect(r).toEqual({ ok: true, fileName: "items.csv", table: { headers: ["Name", "Price", "Unit"], rows: [[hindi, "45", "kg"], ["Salt", "20", "kg"]] } });
  });

  it("strips a BOM and reads a semicolon file", async () => {
    const r = await readImportFile(csv("﻿Name;Price;Unit\nSugar;45;kg"));
    expect(r.ok && r.table.headers).toEqual(["Name", "Price", "Unit"]);
  });

  it("text that is not UTF-8 (Excel's plain 'CSV' on a Windows phone or PC) is refused with the fix, not shown as garbage", async () => {
    const r = await readImportFile(bytes(0x4e, 0x61, 0x6d, 0x65, 0x0a, 0xe9, 0xff, 0xfe)); // "Name\n" then invalid UTF-8
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/UTF-8/);
  });

  it("an empty file, and a file with only a header, say so", async () => {
    const empty = await readImportFile(csv(""));
    expect(empty.ok).toBe(false);
    const headerOnly = await readImportFile(csv("Name,Price,Unit\n"));
    expect(headerOnly.ok).toBe(false);
    if (!headerOnly.ok) expect(headerOnly.error).toMatch(/no rows|nothing below/i);
  });

  it("more than 5,000 rows is refused; exactly 5,000 is fine", async () => {
    const make = (n: number) => `Name,Price,Unit\n${Array.from({ length: n }, (_, i) => `P${i},1,kg`).join("\n")}\n`;
    const ok = await readImportFile(csv(make(5_000)));
    expect(ok.ok && ok.table.rows.length).toBe(5_000);
    const over = await readImportFile(csv(make(5_001)));
    expect(over.ok).toBe(false);
    if (!over.ok) expect(over.error).toMatch(/5,000/);
  });

  it("a file over 5 MB is refused before it is read", async () => {
    const r = await readImportFile(new File([new Uint8Array(5 * 1024 * 1024 + 1)], "big.csv"));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/5 MB/);
  });
});

describe("readImportFile - xlsx", () => {
  const xlsx = (rows: Parameters<typeof makeXlsx>[0], name = "items.xlsx") => new File([makeXlsx(rows)], name);

  it("reads a real workbook: text stays text, numbers become the text of the number, empty cells are empty", async () => {
    const hindi = D(0x91a, 0x940, 0x928, 0x940);
    const r = await readImportFile(xlsx([["Name", "Price", "Unit", "Aliases"], [hindi, 45.5, "kg", null], ["Salt", 20, "kg", "namak"]]));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.table.headers).toEqual(["Name", "Price", "Unit", "Aliases"]);
      expect(r.table.rows).toEqual([[hindi, "45.5", "kg", ""], ["Salt", "20", "kg", "namak"]]);
    }
  });

  it("is recognised by its content, not its name (a workbook called .csv, a csv called .xlsx)", async () => {
    const a = await readImportFile(new File([makeXlsx([["Name", "Price", "Unit"], ["A", 1, "kg"]])], "oops.csv"));
    expect(a.ok && a.table.rows).toEqual([["A", "1", "kg"]]);
    const b = await readImportFile(new File(["Name,Price,Unit\nA,1,kg"], "oops.xlsx"));
    expect(b.ok && b.table.rows).toEqual([["A", "1", "kg"]]);
  });

  it("skips blank rows and takes the first non-empty row as the header", async () => {
    const r = await readImportFile(xlsx([[null, null], ["Name", "Price", "Unit"], [null, null], ["A", 1, "kg"]]));
    expect(r.ok && r.table.headers).toEqual(["Name", "Price", "Unit"]);
    expect(r.ok && r.table.rows).toEqual([["A", "1", "kg"]]);
  });

  it("reads 450 rows", async () => {
    const rows = [["Name", "Price", "Unit"], ...Array.from({ length: 450 }, (_, i) => [`Item ${i}`, i + 1, "kg"])];
    const r = await readImportFile(xlsx(rows));
    expect(r.ok && r.table.rows.length).toBe(450);
  });

  it("a broken workbook says so", async () => {
    const r = await readImportFile(bytes(0x50, 0x4b, 0x03, 0x04, 0x00, 0x01, 0x02));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/read|xlsx/i);
  });

  it("an old .xls (Excel 97-2003) is refused with the way out", async () => {
    const r = await readImportFile(bytes(0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/\.xlsx/);
  });
});
