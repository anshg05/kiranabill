// KB-314 (docs/07-DECISIONS.md D68): a small RFC 4180 reader for the catalog import. Text in, rows of text out - no
// I/O, no browser APIs (domain rule). Handles quoted fields (commas, doubled quotes, newlines inside), CRLF / LF / CR,
// a UTF-8 byte-order mark, and the delimiter Excel picks for the locale (comma, semicolon or tab).

const BOM = "﻿";

/** The delimiter used in the first record: whichever of , ; tab appears most outside quotes (comma wins ties). */
export function detectDelimiter(text: string): string {
  const counts: Record<string, number> = { ",": 0, ";": 0, "\t": 0 };
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === "\n" || ch === "\r")) break;
    else if (!inQuotes && ch in counts) counts[ch] = (counts[ch] ?? 0) + 1;
  }
  let best = ",";
  for (const d of [";", "\t"]) if ((counts[d] ?? 0) > (counts[best] ?? 0)) best = d;
  return best;
}

export function parseCsv(input: string): string[][] {
  const text = input.startsWith(BOM) ? input.slice(1) : input;
  const delimiter = detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let inQuotes = false;
  let fieldStarted = false;

  const endField = () => {
    row.push(field);
    field = "";
    fieldStarted = false;
  };
  const endRow = () => {
    endField();
    if (row.some((cell) => cell.trim() !== "")) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
    } else if (ch === '"' && !fieldStarted) {
      inQuotes = true;
      fieldStarted = true;
    } else if (ch === delimiter) endField();
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      endRow();
    } else {
      field += ch;
      fieldStarted = true;
    }
  }
  if (field !== "" || row.length > 0 || fieldStarted) endRow();
  return rows;
}
