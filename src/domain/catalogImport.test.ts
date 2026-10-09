import { describe, expect, it } from "vitest";
import {
  MAX_SHOP_PRODUCTS,
  SAMPLE_CSV,
  buildPreview,
  detectMapping,
  nameKey,
  normalizeName,
  normalizeUnit,
  parseImportPrice,
  type ExistingProduct,
  type ImportTable,
} from "./catalogImport";
import { parseCsv } from "./csv";

// KB-314 (D68, owner 10 Oct 2026): bulk catalog import - the pure part. A file's text becomes a preview: every row is
// NEW, ALREADY IN THE SHOP, or a PROBLEM with a reason; nothing here writes, and nothing changes an existing product.

const D = (...codes: number[]) => String.fromCharCode(...codes);
const table = (headers: string[], ...rows: string[][]): ImportTable => ({ headers, rows });
const existing = (displayName: string, over: Partial<ExistingProduct> = {}): ExistingProduct => ({ displayName, unit: "kg", pricePaise: 4_800, aliases: [displayName.toLowerCase()], isActive: true, ...over });
const NPU = ["Name", "Price", "Unit"];
const mapNPU = { name: 0, price: 1, unit: 2 };

describe("normalizeName", () => {
  it("is NFC, trimmed, with inner whitespace collapsed", () => {
    expect(normalizeName("  Basmati   Rice \t")).toBe("Basmati Rice");
    expect(normalizeName("Chini  ")).toBe("Chini");
    expect(normalizeName("Cafe" + D(0x301))).toBe("Caf" + D(0xe9)); // e + combining acute -> composed
  });

  it("compares case-insensitively", () => {
    expect(nameKey(" CHINI ")).toBe(nameKey("chini"));
  });
});

describe("parseImportPrice", () => {
  it.each([
    ["45", 4_500],
    ["₹45", 4_500],
    ["₹ 45", 4_500],
    ["Rs. 45", 4_500],
    ["Rs 45.5", 4_550],
    ["INR 12.50", 1_250],
    ["45/-", 4_500],
    ["१२.५०", 1_250], // Devanagari digits
    ["1,250.50", 125_050], // western grouping
    ["₹ 12,500", 1_250_000],
    ["₹ 99,999.50", 9_999_950],
    ["1,00,000", 10_000_000], // Indian grouping, exactly the rate cap
    ["12,50,0", null],
  ])("%s -> %s paise", (text, paise) => {
    const r = parseImportPrice(text);
    if (paise === null) expect(r.ok).toBe(false);
    else expect(r).toEqual({ ok: true, paise });
  });

  it("recognises Indian grouping and then refuses a price above the rate cap - never guesses", () => {
    const r = parseImportPrice("₹ 1,25,000");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/too large/i); // it was READ as 125000, then refused - not 'unclear'
  });

  it.each(["", "  ", "abc", "45,50", "1,2,3", "45.555", "0", "0.00", "-5", "4 5", "1e3", "₹", "45 per kg"])("refuses %j", (text) => {
    expect(parseImportPrice(text).ok).toBe(false);
  });

  it("a decimal comma ('45,50') is unclear, not 4550", () => {
    const r = parseImportPrice("45,50");
    expect(r.ok).toBe(false);
  });

  it("never goes through a float: 0.1 + 0.2 style values are exact paise", () => {
    expect(parseImportPrice("19.99")).toEqual({ ok: true, paise: 1_999 });
    expect(parseImportPrice("1.15")).toEqual({ ok: true, paise: 115 });
  });
});

describe("normalizeUnit", () => {
  it.each([
    ["Kg", "kg"], ["KGS", "kg"], ["kilo", "kg"], ["Kilogram", "kg"], [D(0x915, 0x93f, 0x932, 0x94b), "kg"],
    ["g", "gm"], ["gm", "gm"], ["Gms", "gm"], ["gram", "gm"], [D(0x917, 0x94d, 0x930, 0x93e, 0x92e), "gm"],
    ["l", "liter"], ["ltr", "liter"], ["Litre", "liter"], ["liter", "liter"], [D(0x932, 0x940, 0x91f, 0x930), "liter"],
    ["ml", "ml"], ["Millilitre", "ml"],
    ["pc", "piece"], ["Pcs", "piece"], ["piece", "piece"], ["nos", "piece"], ["each", "piece"], [D(0x928, 0x917), "piece"],
  ])("%s -> %s (a unit the app knows)", (raw, unit) => {
    expect(normalizeUnit(raw)).toEqual({ unit, known: true });
  });

  it("keeps any other unit as typed, lower-cased, and says it is not one the app knows", () => {
    expect(normalizeUnit("Dozen")).toEqual({ unit: "dozen", known: false });
    expect(normalizeUnit("Kgg")).toEqual({ unit: "kgg", known: false });
  });

  it("an empty unit is nothing - it is never defaulted", () => {
    expect(normalizeUnit("")).toBeNull();
    expect(normalizeUnit("   ")).toBeNull();
  });
});

describe("detectMapping", () => {
  it("maps the plain headers, case and punctuation aside", () => {
    expect(detectMapping(["Item Name", "Sale_Price", "UNIT", "Category", "Aliases", "SKU", "Barcode"])).toEqual({ name: 0, price: 1, unit: 2, category: 3, aliases: 4, sku: 5, barcode: 6 });
  });

  it("knows common spreadsheet-export headers", () => {
    expect(detectMapping(["Product", "Rate", "Unit of Measure"])).toEqual({ name: 0, price: 1, unit: 2 });
    expect(detectMapping(["Item name", "Sale price", "Purchase price", "Stock qty", "Primary Unit"])).toEqual({ name: 0, price: 1, unit: 4 });
  });

  it("prefers the sale price to the MRP, and uses the MRP only when it is all there is", () => {
    expect(detectMapping(["Name", "MRP", "Selling price"]).price).toBe(2);
    expect(detectMapping(["Name", "MRP"]).price).toBe(1);
  });

  it("reads Hindi headers and a 'Hindi name' column as aliases", () => {
    expect(detectMapping([D(0x928, 0x93e, 0x92e), D(0x915, 0x940, 0x92e, 0x924)])).toEqual({ name: 0, price: 1 });
    expect(detectMapping(["Name", "Price", "Unit", "Hindi name"]).aliases).toBe(3);
  });

  it("never gives one column to two fields, and leaves unknown headers unmapped", () => {
    const m = detectMapping(["Name", "Foo", "Bar"]);
    expect(m).toEqual({ name: 0 });
  });
});

describe("buildPreview - rows", () => {
  it("a good row is new, with its price in paise and its unit normalised", () => {
    const p = buildPreview(table(NPU, ["Sugar", "₹45", "Kg"]), mapNPU, []);
    expect(p.rows).toHaveLength(1);
    expect(p.rows[0]).toMatchObject({ line: 2, name: "Sugar", pricePaise: 4_500, unit: "kg", status: { kind: "new" } });
    expect(p.counts).toEqual({ new: 1, exists: 0, problem: 0 });
  });

  it("the line number is the file's (the header is line 1)", () => {
    const p = buildPreview(table(NPU, ["A", "1", "kg"], ["B", "", "kg"]), mapNPU, []);
    expect(p.rows[1]).toMatchObject({ line: 3, status: { kind: "problem" } });
  });

  it("a missing name, price or unit is a problem with its own reason - nothing is invented", () => {
    const p = buildPreview(table(NPU, ["", "45", "kg"], ["Sugar", "", "kg"], ["Salt", "20", ""], ["Tea", "abc", "kg"]), mapNPU, []);
    const reasons = p.rows.map((r) => (r.status.kind === "problem" ? r.status.reason : "ok"));
    expect(reasons[0]).toMatch(/name/i);
    expect(reasons[1]).toMatch(/price/i);
    expect(reasons[2]).toMatch(/unit/i);
    expect(reasons[3]).toMatch(/price|amount/i);
    expect(p.counts.problem).toBe(4);
  });

  it("a name or unit that is too long is a problem", () => {
    const long = "x".repeat(101);
    const p = buildPreview(table(NPU, [long, "5", "kg"], ["Ok", "5", "a".repeat(13)]), mapNPU, []);
    expect(p.rows[0]!.status.kind).toBe("problem");
    expect(p.rows[1]!.status.kind).toBe("problem");
  });

  it("control characters never reach a name", () => {
    const p = buildPreview(table(NPU, ["Su" + D(0) + "gar" + D(7), "5", "kg"]), mapNPU, []);
    expect(p.rows[0]!.name).toBe("Sugar");
  });

  it("the same name twice in the file: the first is kept, the second is a problem pointing at the first", () => {
    const p = buildPreview(table(NPU, ["Sugar", "45", "kg"], ["sugar ", "46", "kg"]), mapNPU, []);
    expect(p.rows[0]!.status.kind).toBe("new");
    expect(p.rows[1]!.status).toMatchObject({ kind: "problem" });
    expect((p.rows[1]!.status as { reason: string }).reason).toMatch(/line 2/);
  });

  it("a row with a bad price is a problem even though the name is fine, but one already in the shop is not judged", () => {
    const p = buildPreview(table(NPU, ["Sugar", "garbage", "kg"]), mapNPU, [existing("Sugar")]);
    expect(p.rows[0]!.status.kind).toBe("exists");
  });
});

describe("buildPreview - already in the shop (add-only; nothing is changed)", () => {
  it("matches an existing name after normalisation, with the file's price beside the shop's", () => {
    const p = buildPreview(table(NPU, ["Chini  ", "₹50", "kg"]), mapNPU, [existing("Chini", { pricePaise: 4_800 })]);
    expect(p.rows[0]!.status).toEqual({ kind: "exists", existingUnit: "kg", existingPricePaise: 4_800, filePricePaise: 5_000, hidden: false });
    expect(p.counts).toEqual({ new: 0, exists: 1, problem: 0 });
  });

  it("matches a Devanagari name in decomposed form to the composed one", () => {
    const composed = D(0x929) + D(0x92e); // letter NNNA + MA
    const decomposed = D(0x928, 0x93c) + D(0x92e); // NA + nukta + MA
    expect(composed).not.toBe(decomposed);
    const p = buildPreview(table(NPU, [decomposed, "10", "piece"]), mapNPU, [existing(composed)]);
    expect(p.rows[0]!.status.kind).toBe("exists");
  });

  it("collapsed inner whitespace and case match: 'Basmati   RICE' is 'Basmati Rice'", () => {
    const p = buildPreview(table(NPU, ["Basmati   RICE", "90", "kg"]), mapNPU, [existing("Basmati Rice")]);
    expect(p.rows[0]!.status.kind).toBe("exists");
  });

  it("a hidden (inactive) product still holds the name - the database would refuse it - and says so", () => {
    const p = buildPreview(table(NPU, ["Sugar", "45", "kg"]), mapNPU, [existing("Sugar", { isActive: false })]);
    expect(p.rows[0]!.status).toMatchObject({ kind: "exists", hidden: true });
  });

  it("shows a different unit in the file as information - the shop's unit stays", () => {
    const p = buildPreview(table(NPU, ["Sugar", "45", "gm"]), mapNPU, [existing("Sugar", { unit: "kg" })]);
    expect(p.rows[0]!.status).toMatchObject({ kind: "exists", existingUnit: "kg" });
  });
});

describe("buildPreview - aliases", () => {
  const A = ["Name", "Price", "Unit", "Aliases"];
  const mapA = { ...mapNPU, aliases: 3 };

  it("splits on comma, semicolon, pipe and newline; normalises; keeps the good ones", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "Chini; Shakkar | cheeni,\n  Sweet  Stuff "]), mapA, []);
    expect(p.rows[0]!.aliases).toEqual(["chini", "shakkar", "cheeni", "sweet stuff"]);
    expect(p.rows[0]!.droppedAliases).toEqual([]);
  });

  it("drops an alias shorter than 3 characters, and lists it", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "ch, chini, " + D(0x926, 0x94b)]), mapA, []);
    expect(p.rows[0]!.aliases).toEqual(["chini"]);
    expect(p.rows[0]!.droppedAliases.map((d) => d.alias).sort()).toEqual(["ch", D(0x926, 0x94b)].sort());
    expect(p.rows[0]!.droppedAliases[0]!.why).toMatch(/short|3/i);
  });

  it("drops an alias that equals another product's NAME in the shop, and lists it", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "salt, chini"]), mapA, [existing("Salt")]);
    expect(p.rows[0]!.aliases).toEqual(["chini"]);
    expect(p.rows[0]!.droppedAliases).toEqual([{ alias: "salt", why: expect.stringMatching(/another product/i) }]);
  });

  it("drops an alias that equals another product's ALIAS in the shop", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "shakkar"]), mapA, [existing("Jaggery", { aliases: ["jaggery", "shakkar"] })]);
    expect(p.rows[0]!.aliases).toEqual([]);
    expect(p.rows[0]!.droppedAliases).toHaveLength(1);
  });

  it("drops an alias that equals another NEW row's name, or that two new rows both claim - from both", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "tea leaf, mithai"], ["Tea Leaf", "200", "kg", ""], ["Jaggery", "60", "kg", "mithai"]), mapA, []);
    expect(p.rows[0]!.aliases).toEqual([]);
    expect(p.rows[2]!.aliases).toEqual([]);
    expect(p.rows[0]!.droppedAliases.map((d) => d.alias).sort()).toEqual(["mithai", "tea leaf"]);
    expect(p.rows[2]!.droppedAliases.map((d) => d.alias)).toEqual(["mithai"]);
  });

  it("an alias equal to its OWN name is just a duplicate - kept out quietly, not reported as a clash", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "sugar, chini, chini"]), mapA, []);
    expect(p.rows[0]!.aliases).toEqual(["chini"]);
    expect(p.rows[0]!.droppedAliases).toEqual([]);
  });

  it("a product with every alias dropped is still imported", () => {
    const p = buildPreview(table(A, ["Sugar", "45", "kg", "ab"]), mapA, []);
    expect(p.rows[0]!.status.kind).toBe("new");
  });

  it("an alias that clashes only with a row that is itself a problem or already in the shop is judged against the SHOP's name", () => {
    const p = buildPreview(table(A, ["Salt", "20", "kg", ""], ["Sugar", "45", "kg", "salt"]), mapA, [existing("Salt")]);
    expect(p.rows[0]!.status.kind).toBe("exists");
    expect(p.rows[1]!.aliases).toEqual([]);
  });
});

describe("buildPreview - the rest", () => {
  it("reads optional category, sku and barcode, empty meaning none", () => {
    const p = buildPreview(table(["Name", "Price", "Unit", "Category", "SKU", "Barcode"], ["Sugar", "45", "kg", "Grocery", "S1", "8901"], ["Salt", "20", "kg", "", "", ""]), { name: 0, price: 1, unit: 2, category: 3, sku: 4, barcode: 5 }, []);
    expect(p.rows[0]).toMatchObject({ category: "Grocery", sku: "S1", barcode: "8901" });
    expect(p.rows[1]).toMatchObject({ category: null, sku: null, barcode: null });
  });

  it("lists every distinct unit found, with a count and whether the app knows it - typos show", () => {
    const p = buildPreview(table(NPU, ["A", "1", "Kg"], ["B", "1", "kilo"], ["C", "1", "Kgg"], ["D", "1", "dozen"]), mapNPU, []);
    expect(p.units).toEqual([
      { unit: "kg", known: true, count: 2 },
      { unit: "dozen", known: false, count: 1 },
      { unit: "kgg", known: false, count: 1 },
    ]);
  });

  it("lists the file's columns that are not used", () => {
    const p = buildPreview(table(["Name", "Price", "Unit", "Purchase price", "Stock"], ["A", "1", "kg", "1", "5"]), { name: 0, price: 1, unit: 2 }, []);
    expect(p.ignoredColumns).toEqual(["Purchase price", "Stock"]);
  });

  it("a mapping without a name or price column is a blocker, not a pile of problem rows", () => {
    expect(buildPreview(table(NPU, ["A", "1", "kg"]), { price: 1, unit: 2 }, []).missingColumns).toEqual(["name"]);
    expect(buildPreview(table(NPU, ["A", "1", "kg"]), { name: 0 }, []).missingColumns).toEqual(["price", "unit"]);
  });

  it("rows that would take the shop past the catalog limit are problems, from the first one over", () => {
    const have = Array.from({ length: MAX_SHOP_PRODUCTS - 1 }, (_, i) => existing(`P${i}`));
    const p = buildPreview(table(NPU, ["Fits", "1", "kg"], ["Over", "1", "kg"]), mapNPU, have);
    expect(p.rows[0]!.status.kind).toBe("new");
    expect(p.rows[1]!.status).toMatchObject({ kind: "problem" });
    expect((p.rows[1]!.status as { reason: string }).reason).toMatch(/10,000/);
  });

  it("a cell shorter than the header row is just empty", () => {
    const p = buildPreview(table(NPU, ["Sugar", "45"]), mapNPU, []);
    expect(p.rows[0]!.status).toMatchObject({ kind: "problem" });
  });
});

describe("the sample CSV", () => {
  it("is itself a file the importer accepts, with no problems", () => {
    const rows = parseCsv(SAMPLE_CSV);
    const t = { headers: rows[0]!, rows: rows.slice(1) };
    const p = buildPreview(t, detectMapping(t.headers), []);
    expect(p.missingColumns).toEqual([]);
    expect(p.counts.problem).toBe(0);
    expect(p.counts.new).toBe(t.rows.length);
  });
});
