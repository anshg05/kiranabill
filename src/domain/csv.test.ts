import { describe, expect, it } from "vitest";
import { detectDelimiter, parseCsv } from "./csv";

// KB-314 (D68): a small RFC 4180 reader - quotes, doubled quotes, newlines inside quotes, CRLF, the delimiter an
// Excel in a comma-decimal locale picks (;) and a tab. Text in, rows of text out; no I/O.
describe("parseCsv", () => {
  it("reads plain rows", () => {
    expect(parseCsv("a,b,c\n1,2,3\n")).toEqual([["a", "b", "c"], ["1", "2", "3"]]);
  });

  it("reads CRLF, a lone CR and no final newline the same way", () => {
    expect(parseCsv("a,b\r\n1,2\r\n3,4")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
    expect(parseCsv("a,b\r1,2")).toEqual([["a", "b"], ["1", "2"]]);
  });

  it("reads quoted fields: commas, doubled quotes and newlines inside", () => {
    expect(parseCsv('name,note\n"Salt, iodised","say ""hi"""\n"two\nlines",x')).toEqual([
      ["name", "note"],
      ["Salt, iodised", 'say "hi"'],
      ["two\nlines", "x"],
    ]);
  });

  it("keeps empty fields and short rows as they are", () => {
    expect(parseCsv("a,b,c\n1,,3\n4")).toEqual([["a", "b", "c"], ["1", "", "3"], ["4"]]);
  });

  it("drops rows that are entirely blank, wherever they are", () => {
    expect(parseCsv("a,b\n\n1,2\n , \n3,4\n")).toEqual([["a", "b"], ["1", "2"], ["3", "4"]]);
  });

  it("strips a UTF-8 byte-order mark (Excel's CSV UTF-8)", () => {
    expect(parseCsv("﻿name,price\nSugar,45")[0]).toEqual(["name", "price"]);
  });

  it("detects ; and tab delimiters, and ignores a delimiter inside quotes when deciding", () => {
    expect(parseCsv("name;price\nSugar;45")).toEqual([["name", "price"], ["Sugar", "45"]]);
    expect(parseCsv("name\tprice\nSugar\t45")).toEqual([["name", "price"], ["Sugar", "45"]]);
    expect(detectDelimiter('"a;b;c",d\n1,2')).toBe(",");
  });

  it("an unterminated quote reads to the end instead of throwing", () => {
    expect(parseCsv('a,b\n"open,1\n2,3')).toEqual([["a", "b"], ["open,1\n2,3"]]);
  });

  it("an empty text has no rows", () => {
    expect(parseCsv("")).toEqual([]);
    expect(parseCsv("\n\n")).toEqual([]);
  });

  it("keeps Devanagari text exactly", () => {
    const hindi = String.fromCharCode(0x91a, 0x940, 0x928, 0x940);
    expect(parseCsv(`name,price\n${hindi},45`)[1]).toEqual([hindi, "45"]);
  });
});
