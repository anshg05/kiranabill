import { describe, expect, it } from "vitest";
import {
  CASH,
  codePointLength,
  formatMobile,
  isStorableMobile,
  isStorableName,
  MOBILE_COUNTRY,
  MOBILE_LENGTH,
  MOBILE_START,
  NAME_MAX_CHARS,
  NAME_TOO_LONG,
  parseCustomerName,
  parseIndianMobile,
} from "./customer";

// KB-306 (owner, 3 Oct 2026; D6, D52): the customer on a bill - a name that
// defaults to "Cash" and an optional Indian mobile, stored as exactly 10
// digits. The stored-value rules mirror the bills CHECK constraints exactly
// (customer.e2e.test.ts proves it against Postgres): lengths in CODE POINTS,
// as Postgres char_length counts - never JS .length (UTF-16 units).

const ok = <T,>(value: T) => ({ ok: true, value });

describe("parseCustomerName", () => {
  it.each([
    ["", CASH],
    ["   ", CASH],
    ["cash", CASH],
    ["CASH", CASH],
    ["  Ramesh   Kumar  ", "Ramesh Kumar"],
    ["रामलाल जी", "रामलाल जी"],
    ["Sharma ji 2", "Sharma ji 2"],
    ["Ram\u0000esh\u0007", "Ramesh"], // control characters stripped (Postgres text can't even hold \u0000)
    ["\u0000\u0001", CASH],
  ])("%j -> %j", (input, name) => {
    expect(parseCustomerName(input)).toEqual(ok(name));
  });

  it("60 code points is the limit - counted like Postgres char_length, not JS .length", () => {
    const sixtyEmoji = "😀".repeat(60);
    expect(sixtyEmoji.length).toBe(120); // UTF-16 units - the wrong count
    expect(codePointLength(sixtyEmoji)).toBe(60);
    expect(parseCustomerName(sixtyEmoji)).toEqual(ok(sixtyEmoji));
    expect(parseCustomerName("😀".repeat(61))).toEqual({ ok: false, error: NAME_TOO_LONG });
    expect(parseCustomerName("a".repeat(NAME_MAX_CHARS))).toEqual(ok("a".repeat(60)));
    expect(parseCustomerName("a".repeat(61))).toEqual({ ok: false, error: NAME_TOO_LONG });
    // A Devanagari name is several code points per letter - still code points.
    const dev = "क्षि".repeat(15); // 4 code points each
    expect(codePointLength(dev)).toBe(60);
    expect(parseCustomerName(dev)).toEqual(ok(dev));
    expect(parseCustomerName(`${dev}क`).ok).toBe(false);
  });
});

describe("parseIndianMobile - stored as exactly 10 digits", () => {
  it.each([
    "9876543210",
    "98765 43210",
    "98765-43210",
    "(98765) 43210",
    "+91 98765 43210",
    "+919876543210",
    "+91-98765-43210",
    "919876543210",
    "09876543210",
    "९८७६५४३२१०",
    "+९१ ९८७६५ ४३२१०",
    "6000000000",
    "7123456789",
    "8123456789",
  ])("%j -> a 10-digit number", (input) => {
    const parsed = parseIndianMobile(input);
    expect(parsed.ok).toBe(true);
    expect(parsed.ok && parsed.value).toMatch(/^[6-9][0-9]{9}$/);
  });

  it("every accepted form lands on the same 10 digits", () => {
    for (const input of ["9876543210", "+91 98765 43210", "919876543210", "09876543210", "९८७६५४३२१०"]) {
      expect(parseIndianMobile(input)).toEqual(ok("9876543210"));
    }
  });

  it("empty clears it", () => {
    expect(parseIndianMobile("")).toEqual(ok(null));
    expect(parseIndianMobile("   ")).toEqual(ok(null));
  });

  it.each([
    ["12345", MOBILE_LENGTH],
    ["98765432101", MOBILE_LENGTH],
    ["987654321", MOBILE_LENGTH],
    ["abc", MOBILE_LENGTH],
    ["98765abcde", MOBILE_LENGTH],
    ["5876543210", MOBILE_START],
    ["0000000000", MOBILE_START],
    ["+91 5876543210", MOBILE_START],
    ["+1 9876543210", MOBILE_COUNTRY],
    ["+44 7911 123456", MOBILE_COUNTRY],
  ])("%j -> rejected: %s", (input, error) => {
    expect(parseIndianMobile(input)).toEqual({ ok: false, error });
  });

  it("shown as 98765 43210", () => {
    expect(formatMobile("9876543210")).toBe("98765 43210");
  });
});

describe("stored-value rules = the bills CHECK constraints", () => {
  it("name: 1-60 code points", () => {
    expect(isStorableName("Cash")).toBe(true);
    expect(isStorableName("")).toBe(false);
    expect(isStorableName("😀".repeat(60))).toBe(true);
    expect(isStorableName("😀".repeat(61))).toBe(false);
  });

  it("mobile: null or ^[6-9][0-9]{9}$", () => {
    expect(isStorableMobile(null)).toBe(true);
    expect(isStorableMobile("9876543210")).toBe(true);
    expect(isStorableMobile("+919876543210")).toBe(false);
    expect(isStorableMobile("5876543210")).toBe(false);
    expect(isStorableMobile("")).toBe(false);
  });

  it("whatever the parsers accept is storable", () => {
    for (const n of ["", "  Ramesh  ", "😀".repeat(60), "क्षि".repeat(15), "\u0000x"]) {
      const p = parseCustomerName(n);
      if (p.ok) expect(isStorableName(p.value)).toBe(true);
    }
    for (const m of ["+91 98765 43210", "09876543210", "९८७६५४३२१०", ""]) {
      const p = parseIndianMobile(m);
      if (p.ok) expect(isStorableMobile(p.value)).toBe(true);
    }
  });
});
