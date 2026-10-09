import { strToU8, zipSync } from "fflate";

// KB-314 TEST HELPER (never imported by the app): a minimal, standards-shaped .xlsx - the same parts Excel writes
// (shared strings, one sheet) - so the importer is tried against a real zipped workbook, not a mock.
// `fflate` is read-excel-file's own dependency; it is used here only to write the fixture.

export type XlsxCell = string | number | null;

const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const xml = (s: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n${s}`;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function columnName(index: number): string {
  let n = index + 1;
  let name = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    name = String.fromCharCode(65 + rem) + name;
    n = Math.floor((n - 1) / 26);
  }
  return name;
}

export function makeXlsx(rows: readonly (readonly XlsxCell[])[]): Uint8Array<ArrayBuffer> {
  const strings: string[] = [];
  const stringIndex = new Map<string, number>();
  const sheetRows = rows
    .map((row, r) => {
      const cells = row
        .map((cell, c) => {
          const ref = `${columnName(c)}${r + 1}`;
          if (cell === null) return "";
          if (typeof cell === "number") return `<c r="${ref}"><v>${cell}</v></c>`;
          let at = stringIndex.get(cell);
          if (at === undefined) {
            at = strings.length;
            strings.push(cell);
            stringIndex.set(cell, at);
          }
          return `<c r="${ref}" t="s"><v>${at}</v></c>`;
        })
        .join("");
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      xml(
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>`,
      ),
    ),
    "_rels/.rels": strToU8(xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/officeDocument" Target="xl/workbook.xml"/></Relationships>`)),
    "xl/workbook.xml": strToU8(xml(`<workbook xmlns="${NS}" xmlns:r="${REL}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>`)),
    "xl/_rels/workbook.xml.rels": strToU8(
      xml(`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${REL}/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${REL}/sharedStrings" Target="sharedStrings.xml"/></Relationships>`),
    ),
    "xl/worksheets/sheet1.xml": strToU8(xml(`<worksheet xmlns="${NS}"><sheetData>${sheetRows}</sheetData></worksheet>`)),
    "xl/sharedStrings.xml": strToU8(
      xml(`<sst xmlns="${NS}" count="${strings.length}" uniqueCount="${strings.length}">${strings.map((s) => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join("")}</sst>`),
    ),
  };
  return new Uint8Array(zipSync(files)); // a copy, so the bytes sit in a plain ArrayBuffer (a Blob part)
}
