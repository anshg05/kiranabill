import { MAX_FILE_BYTES, MAX_IMPORT_ROWS, type ImportTable } from "@/domain/catalogImport";
import { parseCsv } from "@/domain/csv";

// KB-314 (docs/07-DECISIONS.md D68): a picked file -> a table of TEXT. A .xlsx is read by `read-excel-file` (pinned,
// SD-030), loaded only when an .xlsx is actually picked - the billing bundle never carries it. A .csv is decoded as
// UTF-8 (a file that is not UTF-8 is refused with the fix, never shown as garbage) and read by domain/csv.ts. The
// kind is decided from the file's first bytes, not its name. Nothing is interpreted here: no price, no unit.

export type ReadResult = { ok: true; table: ImportTable; fileName: string } | { ok: false; error: string };

const fail = (error: string): ReadResult => ({ ok: false, error });

const isZip = (b: Uint8Array) => b[0] === 0x50 && b[1] === 0x4b; // "PK" - an .xlsx is a zip
const isOle = (b: Uint8Array) => b[0] === 0xd0 && b[1] === 0xcf && b[2] === 0x11 && b[3] === 0xe0; // Excel 97-2003 (.xls)

/** One spreadsheet cell as the text a person would have typed. */
function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value);
}

async function readXlsx(file: Blob): Promise<string[][] | null> {
  try {
    const { readSheet } = await import("read-excel-file/universal");
    const sheet = await readSheet(file);
    return sheet.map((row) => row.map(cellText));
  } catch (err) {
    console.warn("[import] could not read the workbook:", err instanceof Error ? err.name : "error");
    return null;
  }
}

export async function readImportFile(file: Blob & { name?: string }): Promise<ReadResult> {
  if (file.size > MAX_FILE_BYTES) return fail("This file is bigger than 5 MB. Split it into smaller files.");
  const head = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  let rows: string[][];
  if (isOle(head)) return fail("This is an old Excel (.xls) file. In Excel use Save As → Excel Workbook (.xlsx), or CSV UTF-8, and pick that.");
  if (isZip(head)) {
    const read = await readXlsx(file);
    if (!read) return fail("Couldn't read this .xlsx file. Open it in Excel and Save As → .xlsx (or CSV UTF-8), then try again.");
    rows = read.filter((r) => r.some((c) => c.trim() !== ""));
  } else {
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(await file.arrayBuffer());
    } catch {
      return fail("This file isn't UTF-8 text, so Hindi names would be garbled. In Excel use Save As → CSV UTF-8, or save as .xlsx.");
    }
    rows = parseCsv(text);
  }
  const [headers, ...body] = rows;
  if (!headers || body.length === 0) return fail("There are no rows below the header — the first row must be the column names.");
  if (body.length > MAX_IMPORT_ROWS) return fail(`This file has ${body.length.toLocaleString("en-IN")} rows; at most 5,000 can be imported at once. Split it into smaller files.`);
  return { ok: true, fileName: file.name ?? "file", table: { headers: headers.map((h) => h.trim()), rows: body } };
}
