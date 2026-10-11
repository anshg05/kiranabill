import { describe, expect, it } from "vitest";
import { checkAliases, checkName, checkNewProduct, lostNameNote, productPatch, type OtherProduct } from "./catalogEdit";

// KB-330 (D71, D77): the pure rules behind Catalog rename, aliases edit and "Add product". They are the KB-314 import's
// rules (same normalisation, same alias judging, same unit and price parsing) - this file pins them for the edit path.

const p = (id: string, displayName: string, aliases: string[] = [], isActive = true): OtherProduct => ({ id, displayName, aliases, isActive });
const others = [p("a", "Sugar", ["chini", "cheeni"]), p("b", "Old Soap", ["purana sabun"], false), p("c", "Atta")];

describe("checkName - rename", () => {
  it("normalises like the import: NFC, controls dropped, whitespace collapsed, trimmed", () => {
    const r = checkName("  Parle‑G \t Biscuit \u0007 ", others);
    expect(r).toEqual({ ok: true, name: "Parle‑G Biscuit" });
    expect(checkName("अ̆ नाम", others)).toEqual({ ok: true, name: "अ̆ नाम".normalize("NFC") });
  });
  it("needs a name, at most 100 characters", () => {
    expect(checkName("   ", others)).toEqual({ ok: false, error: "Name needed" });
    expect(checkName("x".repeat(100), others).ok).toBe(true);
    expect(checkName("x".repeat(101), others)).toEqual({ ok: false, error: "Name is longer than 100 characters" });
  });
  it("refuses another product's name, case-insensitively", () => {
    expect(checkName("SUGAR", others)).toEqual({ ok: false, error: "Another product is already called “SUGAR”" });
  });
  it("refuses an ARCHIVED product's name too - the database index counts it", () => {
    expect(checkName("old soap", others)).toEqual({ ok: false, error: "Another product is already called “old soap” (archived)" });
  });
  it("another product's alias is not a name clash (the import does not refuse it either)", () => {
    expect(checkName("chini", others).ok).toBe(true);
  });
});

describe("checkAliases - the import's alias rules", () => {
  it("keeps good ones lower-cased, one per line or comma-separated, no repeats", () => {
    const r = checkAliases("Rice", "Chawal, chawal\nBasmati;  चावल", others);
    expect(r.aliases).toEqual(["chawal", "basmati", "चावल"]);
    expect(r.dropped).toEqual([]);
  });
  it("lists a dropped one with its reason: too short, too long", () => {
    const r = checkAliases("Rice", `ab, ${"y".repeat(61)}, fine`, others);
    expect(r.aliases).toEqual(["fine"]);
    expect(r.dropped).toEqual([
      { alias: "ab", why: "shorter than 3 characters" },
      { alias: "y".repeat(61), why: "longer than 60 characters" },
    ]);
  });
  it("drops another product's name or alias - active or archived", () => {
    const r = checkAliases("Rice", "chini, atta, purana sabun, old soap, mine", others);
    expect(r.aliases).toEqual(["mine"]);
    expect(r.dropped.map((d) => d.alias)).toEqual(["chini", "atta", "purana sabun", "old soap"]);
    expect(r.dropped.every((d) => d.why === "same as another product's name or alias")).toBe(true);
  });
  it("the product's own name is redundant, not a clash - silently skipped", () => {
    const r = checkAliases("Rice", "rice, chawal", others);
    expect(r.aliases).toEqual(["chawal"]);
    expect(r.dropped).toEqual([]);
  });
});

describe("lostNameNote - a rename stops the old name matching unless it is kept", () => {
  it("names the old name when it is neither the new name nor an alias", () => {
    expect(lostNameNote("Chini", "Sugar", ["cheeni"])).toBe("“Chini” will stop matching when spoken.");
  });
  it("no note when it is kept as an alias, when only the case changed, or when nothing changed", () => {
    expect(lostNameNote("Chini", "Sugar", ["chini"])).toBeNull();
    expect(lostNameNote("chini", "Chini", [])).toBeNull();
    expect(lostNameNote("Chini", "Chini", [])).toBeNull();
  });
});

describe("productPatch - only what changed; never a unit or a price", () => {
  const cur = { displayName: "Chini", aliases: ["chini", "cheeni"] };
  it("nothing changed -> {}", () => {
    expect(productPatch(cur, { displayName: "Chini", aliases: ["chini", "cheeni"] })).toEqual({});
  });
  it("a rename alone sends the name alone", () => {
    expect(productPatch(cur, { displayName: "Sugar", aliases: cur.aliases })).toEqual({ display_name: "Sugar" });
  });
  it("aliases alone send the aliases alone (order of a set of names does not matter)", () => {
    expect(productPatch(cur, { displayName: "Chini", aliases: ["cheeni", "chini"] })).toEqual({});
    expect(productPatch(cur, { displayName: "Chini", aliases: ["chini"] })).toEqual({ aliases: ["chini"] });
  });
  it("both -> both, and no other column ever appears", () => {
    const patch = productPatch(cur, { displayName: "Sugar", aliases: [] });
    expect(Object.keys(patch).sort()).toEqual(["aliases", "display_name"]);
  });
});

describe("checkNewProduct - the Add product form", () => {
  const ok = { name: "  Jaggery ", unit: "KG", price: "₹ 1,250.50" };
  it("a good row: normalised name, the app's own unit spelling, exact integer paise", () => {
    expect(checkNewProduct(ok, others, 3)).toEqual({ ok: true, product: { name: "Jaggery", unit: "kg", unitKnown: true, pricePaise: 125_050 } });
  });
  it("a unit is never defaulted: empty -> 'Unit needed'", () => {
    const r = checkNewProduct({ ...ok, unit: " " }, others, 3);
    expect(r).toEqual({ ok: false, errors: { unit: "Unit needed" } });
  });
  it("a price is never defaulted: empty -> 'Price needed'; 0 and unclear are refused", () => {
    expect(checkNewProduct({ ...ok, price: "" }, others, 3)).toEqual({ ok: false, errors: { price: "Price needed" } });
    expect(checkNewProduct({ ...ok, price: "0" }, others, 3)).toEqual({ ok: false, errors: { price: "Must be more than ₹0" } });
    const unclear = checkNewProduct({ ...ok, price: "45,50" }, others, 3);
    expect(unclear.ok).toBe(false);
  });
  it("an unusual unit is kept as typed, lower-case, marked unknown", () => {
    const r = checkNewProduct({ ...ok, unit: "Dozen" }, others, 3);
    expect(r).toEqual({ ok: true, product: { name: "Jaggery", unit: "dozen", unitKnown: false, pricePaise: 125_050 } });
  });
  it("a unit longer than 12 characters is refused", () => {
    expect(checkNewProduct({ ...ok, unit: "x".repeat(13) }, others, 3)).toEqual({ ok: false, errors: { unit: "Unit is longer than 12 characters" } });
  });
  it("the name rules apply: needed, clash (archived too)", () => {
    expect(checkNewProduct({ ...ok, name: "" }, others, 3)).toEqual({ ok: false, errors: { name: "Name needed" } });
    expect(checkNewProduct({ ...ok, name: "old soap" }, others, 3)).toEqual({ ok: false, errors: { name: "Another product is already called “old soap” (archived)" } });
  });
  it("every error is reported at once", () => {
    const r = checkNewProduct({ name: "", unit: "", price: "" }, others, 3);
    expect(r).toEqual({ ok: false, errors: { name: "Name needed", unit: "Unit needed", price: "Price needed" } });
  });
  it("a catalog already at 10,000 products takes no more", () => {
    expect(checkNewProduct(ok, others, 10_000)).toEqual({ ok: false, errors: { name: "The catalog holds at most 10,000 products" } });
  });
});
