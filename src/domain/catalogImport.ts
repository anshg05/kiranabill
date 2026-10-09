import { MAX_RATE_PAISE, normalizeDigits, parseMoneyInput } from "./billEdit.js";
import { codePointLength } from "./customer.js";

// KB-314 (docs/07-DECISIONS.md D68, owner 10 Oct 2026): bulk catalog import - the pure part. A file's rows (already read
// into text by data/catalogImportFile.ts) become a PREVIEW: every row is NEW, ALREADY IN THE SHOP, or a PROBLEM with a
// reason. Nothing here writes. It is ADD-ONLY: a row matching an existing product's name is skipped - its price and unit
// are never changed (hard rule 7) - and the file's price is only shown beside the shop's. A unit is never defaulted
// (that would invent a unit), a price is integer paise from the text (never a float), and every name is normalised
// the same way before it is compared or stored.

export const MAX_IMPORT_ROWS = 5_000;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** D7: a shop's catalog is bounded at 10,000 products (the client index falls back to the server above that). */
export const MAX_SHOP_PRODUCTS = 10_000;
export const MIN_ALIAS_CHARS = 3;
const NAME_MAX_CHARS = 100;
const UNIT_MAX_CHARS = 12;
const ALIAS_MAX_CHARS = 60;
const CATEGORY_MAX_CHARS = 60;
const CODE_MAX_CHARS = 40;

export type ImportField = "name" | "price" | "unit" | "category" | "aliases" | "sku" | "barcode";
export type ColumnMapping = Partial<Record<ImportField, number>>;
export interface ImportTable {
  headers: string[];
  rows: string[][];
}
export const REQUIRED_FIELDS: readonly ImportField[] = ["name", "price", "unit"];
export const FIELD_LABELS: Record<ImportField, string> = { name: "Name", price: "Price", unit: "Unit", category: "Category", aliases: "Aliases", sku: "SKU", barcode: "Barcode" };

// ---- names, units, prices ------------------------------------------------------------------------------------

// Controls other than whitespace ones are dropped (a NUL cannot even be stored in Postgres text).
const NON_SPACE_CONTROLS = /[\u0000-\u0008\u000E-\u001F\u007F-\u009F]/g;

/** NFC, control characters dropped, inner whitespace collapsed, trimmed - what is compared AND stored. */
export function normalizeName(text: string): string {
  return text.normalize("NFC").replace(NON_SPACE_CONTROLS, "").replace(/\s+/g, " ").trim();
}

/** The comparison key of a name: normalised, case-folded (Latin; Devanagari has no case). */
export const nameKey = (text: string): string => normalizeName(text).toLowerCase();

const UNIT_SPELLINGS: Record<string, readonly string[]> = {
  kg: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms", "किलो", "केजी", "किग्रा", "किलोग्राम"],
  gm: ["g", "gm", "gms", "gram", "grams", "gr", "ग्राम", "ग्रा"],
  liter: ["l", "lt", "ltr", "ltrs", "litre", "litres", "liter", "liters", "लीटर", "ली"],
  ml: ["ml", "mls", "millilitre", "millilitres", "milliliter", "milliliters", "मिली"],
  piece: ["pc", "pcs", "piece", "pieces", "no", "nos", "number", "each", "unit", "units", "नग", "पीस", "अदद"],
};
const UNIT_BY_SPELLING = new Map(Object.entries(UNIT_SPELLINGS).flatMap(([unit, spellings]) => spellings.map((s) => [s, unit] as const)));

/** The app's own spelling of a unit (kg, gm, liter, ml, piece); any other text is kept as typed (lower-case), `known: false`. Empty -> null. */
export function normalizeUnit(raw: string): { unit: string; known: boolean } | null {
  const text = normalizeName(raw).toLowerCase().replace(/\.$/, "");
  if (text === "") return null;
  const unit = UNIT_BY_SPELLING.get(text);
  return unit ? { unit, known: true } : { unit: text, known: false };
}

const WESTERN_GROUPING = /^\d{1,3}(,\d{3})+(\.\d+)?$/; // 1,250.50
const INDIAN_GROUPING = /^\d{1,2}(,\d{2})+,\d{3}(\.\d+)?$/; // 1,25,000

/**
 * Rupees as a spreadsheet holds them -> exact integer paise. Accepts a leading rupee sign / Rs / INR, a trailing "/-",
 * Devanagari digits and western or Indian digit grouping; refuses anything unclear ("45,50" - a decimal comma - is
 * never guessed) and more than 2 decimals. The same cap as a typed rate (billEdit), so "₹ 1,25,000" is read as 125000
 * and then refused as too large - not reported as unclear.
 */
export function parseImportPrice(text: string): { ok: true; paise: number } | { ok: false; error: string } {
  let t = normalizeDigits(text).trim();
  t = t.replace(/^(?:₹|rs\.?|inr)\s*/i, "").replace(/\s*\/[-=]\s*$/, "").trim();
  if (t === "") return { ok: false, error: "Price needed" };
  if (t.includes(",")) {
    if (!WESTERN_GROUPING.test(t) && !INDIAN_GROUPING.test(t)) return { ok: false, error: "Price unclear — use digits like 45 or 1,250.50" };
    t = t.replace(/,/g, "");
  }
  const parsed = parseMoneyInput(t, MAX_RATE_PAISE);
  return parsed.ok ? { ok: true, paise: parsed.value } : { ok: false, error: parsed.error };
}

// ---- header mapping ------------------------------------------------------------------------------------------

// Synonyms in priority order: the first one found wins (so a sale price beats an MRP, which is used only when alone).
const SYNONYMS: Record<ImportField, readonly string[]> = {
  name: ["name", "item name", "item", "product name", "product", "display name", "particulars", "item description", "description", "नाम", "सामान", "आइटम", "वस्तु"],
  price: ["sale price", "selling price", "price", "rate", "selling rate", "sp", "mrp", "कीमत", "भाव", "दाम", "मूल्य"],
  unit: ["unit", "uom", "unit of measure", "units", "primary unit", "measure", "इकाई", "यूनिट"],
  category: ["category", "item category", "group", "श्रेणी", "कैटेगरी"],
  aliases: ["aliases", "alias", "other names", "other name", "also called", "hindi name", "hinglish name", "hinglish", "hindi", "local name", "उपनाम"],
  sku: ["sku", "item code", "product code", "code"],
  barcode: ["barcode", "bar code", "ean", "upc", "gtin"],
};
const FIELD_ORDER: readonly ImportField[] = ["name", "price", "unit", "category", "aliases", "sku", "barcode"];

const headerKey = (h: string): string => normalizeName(h).toLowerCase().replace(/[_\-./]+/g, " ").replace(/\s+/g, " ").trim();

/** Which column holds which field, by header name. A column serves one field; unknown headers are left unmapped. */
export function detectMapping(headers: readonly string[]): ColumnMapping {
  const keys = headers.map(headerKey);
  const used = new Set<number>();
  const mapping: ColumnMapping = {};
  for (const field of FIELD_ORDER) {
    for (const synonym of SYNONYMS[field]) {
      const at = keys.findIndex((k, i) => k === synonym && !used.has(i));
      if (at >= 0) {
        mapping[field] = at;
        used.add(at);
        break;
      }
    }
  }
  return mapping;
}

// ---- the preview ---------------------------------------------------------------------------------------------

export interface ExistingProduct {
  displayName: string;
  unit: string;
  pricePaise: number;
  aliases: readonly string[];
  isActive: boolean;
}

export type RowStatus =
  | { kind: "new" }
  | { kind: "exists"; existingUnit: string; existingPricePaise: number; filePricePaise: number | null; hidden: boolean }
  | { kind: "problem"; reason: string };

export interface PreviewRow {
  /** The file's line: the header is line 1. */
  line: number;
  name: string;
  pricePaise: number | null;
  unit: string;
  unitKnown: boolean;
  category: string | null;
  aliases: string[];
  droppedAliases: { alias: string; why: string }[];
  sku: string | null;
  barcode: string | null;
  status: RowStatus;
}

export interface ImportPreview {
  rows: PreviewRow[];
  counts: { new: number; exists: number; problem: number };
  /** The distinct units among the rows to be added - typos ("kgg") show here. */
  units: { unit: string; known: boolean; count: number }[];
  ignoredColumns: string[];
  /** Required fields with no column: nothing can be previewed until they are mapped. */
  missingColumns: ImportField[];
}

const EMPTY_COUNTS = { new: 0, exists: 0, problem: 0 };
const ALIAS_SPLIT = /[,;|\n\r]+/;

function splitAliases(text: string): string[] {
  return [...new Set(text.split(ALIAS_SPLIT).map(nameKey).filter((a) => a !== ""))];
}

export function buildPreview(table: ImportTable, mapping: ColumnMapping, existing: readonly ExistingProduct[]): ImportPreview {
  const mapped = new Set(Object.values(mapping));
  const ignoredColumns = table.headers.filter((h, i) => !mapped.has(i) && h.trim() !== "");
  const missingColumns = REQUIRED_FIELDS.filter((f) => mapping[f] === undefined);
  if (missingColumns.length > 0) return { rows: [], counts: { ...EMPTY_COUNTS }, units: [], ignoredColumns, missingColumns };

  const cell = (row: readonly string[], field: ImportField): string => {
    const at = mapping[field];
    return at === undefined ? "" : (row[at] ?? "");
  };
  const existingByKey = new Map(existing.map((p) => [nameKey(p.displayName), p] as const));
  const firstLine = new Map<string, number>();
  const rows: PreviewRow[] = [];
  let catalogSize = existing.length;

  table.rows.forEach((raw, index) => {
    const line = index + 2;
    const name = normalizeName(cell(raw, "name"));
    const price = parseImportPrice(cell(raw, "price"));
    const unit = normalizeUnit(cell(raw, "unit"));
    const optional = (field: ImportField, max: number) => {
      const value = normalizeName(cell(raw, field));
      return { value: value === "" ? null : value, tooLong: codePointLength(value) > max };
    };
    const category = optional("category", CATEGORY_MAX_CHARS);
    const sku = optional("sku", CODE_MAX_CHARS);
    const barcode = optional("barcode", CODE_MAX_CHARS);
    const row: PreviewRow = {
      line,
      name,
      pricePaise: price.ok ? price.paise : null,
      unit: unit?.unit ?? "",
      unitKnown: unit?.known ?? false,
      category: category.tooLong ? null : category.value,
      aliases: [],
      droppedAliases: [],
      sku: sku.tooLong ? null : sku.value,
      barcode: barcode.tooLong ? null : barcode.value,
      status: { kind: "new" },
    };
    const problem = (reason: string) => {
      row.status = { kind: "problem", reason };
      rows.push(row);
    };

    if (name === "") return problem("Name needed");
    if (codePointLength(name) > NAME_MAX_CHARS) return problem(`Name is longer than ${NAME_MAX_CHARS} characters`);
    const key = nameKey(name);
    const earlier = firstLine.get(key);
    if (earlier !== undefined) return problem(`Name repeated in the file — same as line ${earlier}`);
    firstLine.set(key, line);

    const have = existingByKey.get(key);
    if (have) {
      row.status = { kind: "exists", existingUnit: have.unit, existingPricePaise: have.pricePaise, filePricePaise: row.pricePaise, hidden: !have.isActive };
      rows.push(row);
      return;
    }
    if (!price.ok) return problem(price.error);
    if (unit === null) return problem("Unit needed");
    if (codePointLength(unit.unit) > UNIT_MAX_CHARS) return problem(`Unit is longer than ${UNIT_MAX_CHARS} characters`);
    if (category.tooLong) return problem(`Category is longer than ${CATEGORY_MAX_CHARS} characters`);
    if (sku.tooLong) return problem(`SKU is longer than ${CODE_MAX_CHARS} characters`);
    if (barcode.tooLong) return problem(`Barcode is longer than ${CODE_MAX_CHARS} characters`);
    if (catalogSize + 1 > MAX_SHOP_PRODUCTS) return problem("The catalog holds at most 10,000 products — this row would pass the limit");
    catalogSize += 1;
    rows.push(row);
  });

  // Aliases: judged after every row's status is known, against the shop's names and aliases and the file's other new rows.
  const newRows = rows.filter((r) => r.status.kind === "new");
  const aliasColumn = mapping.aliases;
  if (aliasColumn !== undefined) {
    const shopKeys = new Set(existing.flatMap((p) => [nameKey(p.displayName), ...p.aliases.map(nameKey)]));
    const newNames = new Map(newRows.map((r) => [nameKey(r.name), r.line] as const));
    const claims = new Map<string, Set<number>>();
    const candidates = newRows.map((r) => ({ row: r, aliases: splitAliases(table.rows[r.line - 2]![aliasColumn] ?? "") }));
    for (const { row, aliases } of candidates) for (const a of aliases) (claims.get(a) ?? claims.set(a, new Set()).get(a)!).add(row.line);
    for (const { row, aliases } of candidates) {
      const own = nameKey(row.name);
      for (const alias of aliases) {
        if (alias === own) continue; // the name itself is always matched - not a clash, just redundant
        const why =
          codePointLength(alias) < MIN_ALIAS_CHARS
            ? `shorter than ${MIN_ALIAS_CHARS} characters`
            : codePointLength(alias) > ALIAS_MAX_CHARS
              ? `longer than ${ALIAS_MAX_CHARS} characters`
              : shopKeys.has(alias) || (newNames.has(alias) && newNames.get(alias) !== row.line)
                ? "same as another product's name or alias"
                : (claims.get(alias)?.size ?? 0) > 1
                  ? "also wanted by another product in the file"
                  : null;
        if (why) row.droppedAliases.push({ alias, why });
        else row.aliases.push(alias);
      }
    }
  }

  const counts = { ...EMPTY_COUNTS };
  for (const r of rows) counts[r.status.kind === "new" ? "new" : r.status.kind === "exists" ? "exists" : "problem"] += 1;
  const unitCounts = new Map<string, { known: boolean; count: number }>();
  for (const r of newRows) unitCounts.set(r.unit, { known: r.unitKnown, count: (unitCounts.get(r.unit)?.count ?? 0) + 1 });
  const units = [...unitCounts].map(([unit, v]) => ({ unit, ...v })).sort((a, b) => b.count - a.count || a.unit.localeCompare(b.unit));
  return { rows, counts, units, ignoredColumns, missingColumns: [] };
}

/** A starter file: the shape the importer reads, with Hindi names and aliases. */
export const SAMPLE_CSV = [
  "Name,Price,Unit,Category,Aliases",
  'Sugar,45,kg,Grocery,"chini, cheeni, चीनी"',
  'Basmati Rice,95.50,kg,Grocery,"basmati chawal"',
  'Parle-G 10,10,piece,Biscuits,"parle g, parleg"',
  "Tata Salt,28,kg,Grocery,namak",
  'Refined Oil,150,liter,Oil,"tel, refined tel"',
  "",
].join("\n");
