import { describe, expect, it } from "vitest";
import { BILL_LANGUAGES, SHOP_NAME_MAX_CHARS, isBillLanguage, parseShopName, parseShopPhone } from "./shopSettings";

// KB-312 (S7): what a shopkeeper may type into Settings. Domain only - no I/O.
describe("shop settings rules", () => {
  it("a shop name: trimmed, inner spaces collapsed, control characters dropped; required; 60 code points at most", () => {
    expect(parseShopName("  Sharma   Kirana\u0007 ")).toEqual({ ok: true, value: "Sharma Kirana" });
    expect(parseShopName("   ")).toEqual({ ok: false, error: "Shop name is required." });
    expect(parseShopName("क".repeat(SHOP_NAME_MAX_CHARS))).toMatchObject({ ok: true });
    expect(parseShopName("क".repeat(SHOP_NAME_MAX_CHARS + 1))).toMatchObject({ ok: false });
    expect(parseShopName("😀".repeat(SHOP_NAME_MAX_CHARS))).toMatchObject({ ok: true }); // code points, not UTF-16 units
  });

  it("a shop phone is an Indian mobile (the customer-mobile rule): 10 digits starting 6-9, empty clears it", () => {
    expect(parseShopPhone("98765 43210")).toEqual({ ok: true, value: "9876543210" });
    expect(parseShopPhone("+91 98765-43210")).toEqual({ ok: true, value: "9876543210" });
    expect(parseShopPhone("")).toEqual({ ok: true, value: null });
    expect(parseShopPhone("12345")).toMatchObject({ ok: false });
    // NI-39: a landline with an STD code is refused for MVP.
    expect(parseShopPhone("0712-2345678")).toMatchObject({ ok: false });
    expect(parseShopPhone("(0712) 2345678")).toMatchObject({ ok: false });
    expect(parseShopPhone("०७१२-२३४५६७८")).toMatchObject({ ok: false }); // Devanagari digits too
    expect(parseShopPhone("09876543210")).toMatchObject({ ok: false }); // a customer's 0-prefixed mobile is fine, a shop's is refused
  });

  it("bill language: en, hi or both - nothing else", () => {
    expect([...BILL_LANGUAGES]).toEqual(["en", "hi", "both"]);
    expect(isBillLanguage("hi")).toBe(true);
    expect(isBillLanguage("fr")).toBe(false);
    expect(isBillLanguage(undefined)).toBe(false);
  });
});
